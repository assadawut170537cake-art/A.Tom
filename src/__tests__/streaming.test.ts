import { act } from '@testing-library/react-native';

import { requestSSE } from '../core/http/request';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { formatSources } from '../features/ai/adapters/GeminiAdapter';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { GEMINI, OPENROUTER, httpError, isClassifierCall, json, mockFetch, sse } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const geminiChunk = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, ...extra }],
});
const user = (content: string) => [{ role: 'user' as const, content }];

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
  resetStore();
  useAtomStore.setState({ historyLoaded: true, streamingId: null });
});

afterEach(() => jest.restoreAllMocks());

describe('requestSSE', () => {
  test('emits every data event except [DONE], across chunk boundaries', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode('data: {"a":1}\n\nda'));
        c.enqueue(enc.encode('ta: {"a":2}\n\n'));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const got: string[] = [];
    await requestSSE('x', 'https://x.test', { method: 'POST' }, (d) => got.push(d));
    expect(got).toEqual(['{"a":1}', '{"a":2}']);
  });

  test('a plain JSON reply (no SSE) is delivered as one event', async () => {
    mockFetch([[/x\.test/, () => json({ ok: true })]]);
    const got: string[] = [];
    await requestSSE('x', 'https://x.test', {}, (d) => got.push(d));
    expect(got).toEqual(['{"ok":true}']);
  });

  test('HTTP errors map to ProviderError like request()', async () => {
    mockFetch([[/x\.test/, () => httpError(429)]]);
    await expect(requestSSE('x', 'https://x.test', {}, () => undefined)).rejects.toMatchObject({ kind: 'rate_limit' });
  });
});

describe('Gemini streaming + web search', () => {
  const gemini = () => {
    const p = aiRegistry.get('gemini');
    if (!p?.chatStream) throw new Error('gemini has no chatStream');
    return p as Required<typeof p>;
  };

  test('streams cumulative text and appends search sources', async () => {
    const { calls } = mockFetch([
      [
        GEMINI,
        () =>
          sse([
            geminiChunk('สวัส'),
            geminiChunk('ดีครับ', {
              groundingMetadata: { groundingChunks: [{ web: { uri: 'https://news.test/a', title: 'ข่าว' } }] },
            }),
          ]),
      ],
    ]);
    const partials: string[] = [];
    const res = await gemini().chatStream({ model: 'm', messages: user('ข่าว'), webSearch: true }, (t) => partials.push(t));
    expect(partials).toEqual(['สวัส', 'สวัสดีครับ']);
    expect(res.content).toBe('สวัสดีครับ\n\nแหล่งข้อมูล: [ข่าว](https://news.test/a)');
    expect(nth(calls, 0).url.href).toContain(':streamGenerateContent?alt=sse');
    expect(nth(calls, 0).body).toMatchObject({ tools: [{ google_search: {} }] });
  });

  test('400 with search on → retried once without tools', async () => {
    const { calls } = mockFetch([
      [GEMINI, (c) => ((c.body as { tools?: unknown }).tools ? httpError(400, 'tool not supported') : sse([geminiChunk('ok')]))],
    ]);
    const res = await gemini().chatStream({ model: 'm', messages: user('x'), webSearch: true }, () => undefined);
    expect(res.content).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(nth(calls, 1).body).not.toHaveProperty('tools');
  });

  test('formatSources dedupes, caps at 3 and skips non-http links', () => {
    const web = (uri: string) => ({ web: { uri, title: uri.slice(-1) } });
    expect(formatSources([web('https://a/1'), web('https://a/1'), web('ftp://x/2'), web('https://a/3'), web('https://a/4'), web('https://a/5')])).toBe(
      '\n\nแหล่งข้อมูล: [1](https://a/1) · [3](https://a/3) · [4](https://a/4)'
    );
    expect(formatSources([])).toBe('');
  });
});

describe('Orchestrator streaming', () => {
  test('falls back to the next provider and resets the partial text first', async () => {
    await ProviderSettings.setPriority(['gemini', 'openrouter']);
    mockFetch([
      [
        GEMINI,
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              async start(c) {
                c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(geminiChunk('ครึ่ง'))}\n\n`));
                // error() ทิ้ง chunk ที่ค้างในคิว — รอให้ฝั่งอ่านรับ chunk แรกก่อน
                await new Promise((r) => setTimeout(r, 5));
                c.error(new Error('socket closed'));
              },
            })
          ),
      ],
      [OPENROUTER, () => sse([{ choices: [{ delta: { content: 'เต็ม' } }] }, '[DONE]'])],
    ]);
    const partials: string[] = [];
    const res = await new Orchestrator().chat({ messages: user('x'), onText: (t) => partials.push(t) });
    expect(res.content).toBe('เต็ม');
    expect(partials).toEqual(['ครึ่ง', '', 'เต็ม']);
  });

  test('streaming off → plain chat(); OpenRouter search only with webSearchPaid', async () => {
    await ProviderSettings.setPriority(['openrouter']);
    await ProviderSettings.setAdvanced({ streaming: false, webSearchPaid: true });
    const { calls } = mockFetch([[OPENROUTER, () => json({ choices: [{ message: { content: 'ok' } }] })]]);
    await new Orchestrator().chat({ messages: user('x'), webSearch: true, onText: () => undefined });
    expect(nth(calls, 0).body).toMatchObject({ plugins: [{ id: 'web' }] });
    expect(nth(calls, 0).body).not.toHaveProperty('stream');
  });

  test('webSearch is not requested unless the caller asks (classifier calls stay plain)', async () => {
    await ProviderSettings.setPriority(['gemini']);
    const { calls } = mockFetch([[GEMINI, () => json(geminiChunk('ok'))]]);
    await new Orchestrator().chat({ messages: user('x') });
    expect(nth(calls, 0).body).not.toHaveProperty('tools');
    expect(nth(calls, 0).url.href).toContain(':generateContent');
  });
});

describe('conversation streaming', () => {
  test('shows the reply while it streams, then saves the final text once', async () => {
    jest.spyOn(voiceOrchestrator, 'speak').mockResolvedValue(undefined);
    await ProviderSettings.setPriority(['gemini']);
    let seenWhileStreaming: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    mockFetch([
      [
        GEMINI,
        (c) =>
          isClassifierCall(c)
            ? json(geminiChunk('{"intent":"chat","confidence":0.9}'))
            : new Response(
                new ReadableStream<Uint8Array>({
                  async start(ctrl) {
                    const enc = new TextEncoder();
                    ctrl.enqueue(enc.encode(`data: ${JSON.stringify(geminiChunk('กำลัง'))}\n\n`));
                    await gate;
                    ctrl.enqueue(enc.encode(`data: ${JSON.stringify(geminiChunk('ตอบ'))}\n\n`));
                    ctrl.close();
                  },
                })
              ),
      ],
    ]);
    const pending = sendMessage('สวัสดี', { speak: false });
    await act(async () => {
      for (let i = 0; i < 20 && !useAtomStore.getState().streamingId; i++) await new Promise((r) => setTimeout(r, 5));
    });
    seenWhileStreaming = useAtomStore.getState().messagesByPersona[1].map((m) => m.content);
    expect(useAtomStore.getState().streamingId).not.toBeNull();
    release();
    await act(async () => void (await pending));
    expect(seenWhileStreaming).toEqual(['สวัสดี', 'กำลัง']);
    expect(useAtomStore.getState().messagesByPersona[1].map((m) => m.content)).toEqual(['สวัสดี', 'กำลังตอบ']);
    expect(useAtomStore.getState().streamingId).toBeNull();
  });

  test('a failed stream leaves no half-written reply behind', async () => {
    await ProviderSettings.setPriority(['gemini']);
    await ProviderSettings.setEnabled('openrouter', false);
    mockFetch([
      [
        GEMINI,
        (c) =>
          isClassifierCall(c)
            ? json(geminiChunk('{"intent":"chat","confidence":0.9}'))
            : new Response(
                new ReadableStream<Uint8Array>({
                  async start(ctrl) {
                    ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(geminiChunk('ครึ่ง'))}\n\n`));
                    await new Promise((r) => setTimeout(r, 5));
                    ctrl.error(new Error('reset'));
                  },
                })
              ),
      ],
    ]);
    const res = await sendMessage('สวัสดี', { speak: false });
    expect(res.error).toBeDefined();
    const roles = useAtomStore.getState().messagesByPersona[1].map((m) => m.role);
    expect(roles).toEqual(['user', 'system']);
  });
});
