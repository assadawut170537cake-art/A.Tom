import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { createProvider, PROVIDERS } from '../features/ai';
import { GeminiAdapter } from '../features/ai/adapters/GeminiAdapter';
import { JevAdapter } from '../features/ai/adapters/JevAdapter';
import { OpenAICompatibleAdapter } from '../features/ai/adapters/OpenAICompatibleAdapter';
import { OpenRouterAdapter } from '../features/ai/adapters/OpenRouterAdapter';
import { ProviderRegistry, aiRegistry } from '../features/ai/core/ProviderRegistry';
import type { AIProviderConfig } from '../features/ai/core/types';
import {
  GEMINI,
  JEV,
  OPENROUTER,
  geminiText,
  httpError,
  json,
  mockFetch,
  openRouterText,
} from '../test-utils/mockFetch';
import { registerAll, setAIKeys } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

const config = (id: AIProviderConfig['id']) => PROVIDERS.find((p) => p.id === id)!;
const gemini = () => aiRegistry.get('gemini') as GeminiAdapter;
const openrouter = () => aiRegistry.get('openrouter') as OpenRouterAdapter;
const jev = () => aiRegistry.get('jev') as JevAdapter;

const REQ = {
  model: 'm',
  messages: [
    { role: 'system' as const, content: 'sys A' },
    { role: 'system' as const, content: 'sys B' },
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'yo' },
    { role: 'user' as const, content: 'again' },
  ],
  temperature: 0.3,
  maxTokens: 64,
};

beforeAll(registerAll);
beforeEach(() => setAIKeys(['gemini', 'openrouter', 'jev']));
afterEach(() => jest.restoreAllMocks());

describe('registry + factory', () => {
  test('createProvider picks the adapter by type (and id for OpenRouter)', () => {
    expect(createProvider(config('gemini'))).toBeInstanceOf(GeminiAdapter);
    expect(createProvider(config('openrouter'))).toBeInstanceOf(OpenRouterAdapter);
    expect(createProvider(config('jev'))).toBeInstanceOf(JevAdapter);
    const custom = createProvider({ ...config('openrouter'), id: 'custom', type: 'custom' });
    expect(custom).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(custom).not.toBeInstanceOf(OpenRouterAdapter);
    expect(
      createProvider({ ...config('openrouter'), id: 'custom', type: 'openai-compatible' })
    ).not.toBeInstanceOf(OpenRouterAdapter);
  });

  test('registry: register replaces by id, listEnabled follows config', () => {
    const reg = new ProviderRegistry();
    PROVIDERS.forEach((p) => reg.register(createProvider(p)));
    reg.register(createProvider({ ...config('gemini'), name: 'Gemini v2' }));
    expect(reg.list().map((p) => p.config.id)).toEqual(['gemini', 'openrouter', 'jev']);
    expect(reg.get('gemini')?.config.name).toBe('Gemini v2');
    expect(reg.listEnabled().map((p) => p.config.id)).toEqual(['gemini', 'openrouter']);
    expect(reg.get('custom')).toBeUndefined();
  });

  test('missing key → missing_key before any request', async () => {
    await setAIKeys([]);
    const { spy } = mockFetch([]);
    for (const p of [gemini(), openrouter(), jev()]) {
      await expect(p.testConnection()).resolves.toEqual({
        ok: false,
        error: `[${p.config.id}] ยังไม่ได้ตั้งค่า API key`,
      });
    }
    await expect(gemini().chat(REQ)).rejects.toMatchObject({ kind: 'missing_key' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('GeminiAdapter (mocked generativelanguage API)', () => {
  test('chat: system instructions merged, roles mapped, generation config, key in header', async () => {
    const { calls } = mockFetch([[GEMINI, () => geminiText('ok')]]);
    await gemini().chat({ ...REQ, model: 'gemini-2.5-flash', timeoutMs: 5000 });
    const c = nth(calls, 0);
    expect(c.url.href).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect(c.url.searchParams.has('key')).toBe(false);
    expect(c.headers['x-goog-api-key']).toBe('gemini-test-key');
    expect(c.body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'yo' }] },
        { role: 'user', parts: [{ text: 'again' }] },
      ],
      systemInstruction: { parts: [{ text: 'sys A\n\nsys B' }] },
      generationConfig: { temperature: 0.3, maxOutputTokens: 64 },
    });
  });

  test('chat: multi-part text joined; no usage → tokensUsed undefined; model from request', async () => {
    mockFetch([[GEMINI, () => json({ candidates: [{ content: { parts: [{ text: 'สวัส' }, { text: 'ดี' }, {}] } }] })]]);
    await expect(gemini().chat(REQ)).resolves.toEqual({
      content: 'สวัสดี',
      model: 'm',
      providerId: 'gemini',
      tokensUsed: undefined,
    });
  });

  test.each([
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'ไม่มีคำตอบ (SAFETY)'],
    [{ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }, 'ไม่มีคำตอบ (MAX_TOKENS)'],
    [{}, 'ไม่มีข้อความในคำตอบ'],
  ])('empty/blocked answer %j → invalid_response', async (body, message) => {
    mockFetch([[GEMINI, () => json(body)]]);
    await expect(gemini().chat(REQ)).rejects.toMatchObject({
      kind: 'invalid_response',
      message: `[gemini] ${message}`,
    });
  });

  test('non-JSON body → invalid_response', async () => {
    mockFetch([[GEMINI, () => new Response('<html>oops</html>')]]);
    await expect(gemini().chat(REQ)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  test('getModels keeps generateContent models, strips "models/", sorted; probe uses pageSize=1', async () => {
    const { calls } = mockFetch([
      [
        GEMINI,
        () =>
          json({
            models: [
              { name: 'models/gemini-3-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
              { name: 'models/legacy' },
            ],
          }),
      ],
    ]);
    await expect(gemini().getModels()).resolves.toEqual(['gemini-2.5-flash', 'gemini-3-pro']);
    await expect(gemini().testConnection()).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url.searchParams.get('pageSize'))).toEqual(['1000', '1']);
  });

  test('getModels with an empty list', async () => {
    mockFetch([[GEMINI, () => json({})]]);
    await expect(gemini().getModels()).resolves.toEqual([]);
  });
});

describe('OpenRouter / OpenAI-compatible (mocked openrouter.ai)', () => {
  test('chat: /chat/completions with bearer + attribution headers, usage parsed', async () => {
    const { calls } = mockFetch([[OPENROUTER, () => openRouterText('สวัสดี', 'anthropic/claude')]]);
    await expect(openrouter().chat(REQ)).resolves.toEqual({
      content: 'สวัสดี',
      model: 'anthropic/claude',
      providerId: 'openrouter',
      tokensUsed: { input: 5, output: 3 },
    });
    const c = nth(calls, 0);
    expect(c.url.href).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.headers).toMatchObject({
      Authorization: 'Bearer openrouter-test-key',
      'HTTP-Referer': 'https://github.com/assadawut170537cake-art/A.Tom',
      'X-Title': 'A.T.O.M.',
    });
    expect(c.body).toEqual({ model: 'm', messages: REQ.messages, temperature: 0.3, max_tokens: 64 });
  });

  test('chat: missing usage / model fall back; null content → invalid_response', async () => {
    mockFetch([[OPENROUTER, () => json({ choices: [{ message: { content: '' } }] })]]);
    await expect(openrouter().chat(REQ)).resolves.toEqual({
      content: '',
      model: 'm',
      providerId: 'openrouter',
      tokensUsed: undefined,
    });
    jest.restoreAllMocks();
    mockFetch([[OPENROUTER, () => json({ choices: [{ message: { content: null } }] })]]);
    await expect(openrouter().chat(REQ)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  test('dynamic model list from /models (sorted); probe validates the key via /key', async () => {
    const { calls } = mockFetch([
      [/openrouter\.ai\/api\/v1\/models/, () => json({ data: [{ id: 'z/model' }, { id: 'a/model' }] })],
      [/openrouter\.ai\/api\/v1\/key/, () => json({ data: { label: 'k' } })],
    ]);
    await expect(openrouter().getModels()).resolves.toEqual(['a/model', 'z/model']);
    await expect(openrouter().testConnection()).resolves.toEqual({ ok: true });
    expect(nth(calls, 1).url.pathname).toBe('/api/v1/key');

    jest.restoreAllMocks();
    mockFetch([[OPENROUTER, () => json({})]]);
    await expect(openrouter().getModels()).resolves.toEqual([]);
  });

  test('probe 401 → readable auth error', async () => {
    mockFetch([[OPENROUTER, () => json({ error: { message: 'No auth credentials found', code: 401 } }, 401)]]);
    await expect(openrouter().testConnection()).resolves.toEqual({
      ok: false,
      error: '[openrouter] HTTP 401: API key ไม่ถูกต้องหรือไม่มีสิทธิ์ — No auth credentials found',
    });
  });

  test('generic OpenAI-compatible: static model list and /models probe', async () => {
    const custom = new OpenAICompatibleAdapter({
      ...config('openrouter'),
      id: 'custom',
      baseURL: 'https://llm.local/v1/',
      models: ['a', 'b'],
    });
    await setAIKeys([]);
    await SecureKeyStore.set('ai.custom', 'ck');
    const { calls } = mockFetch([[/llm\.local/, () => json({ data: [] })]]);
    await expect(custom.getModels()).resolves.toEqual(['a', 'b']);
    await expect(custom.testConnection()).resolves.toEqual({ ok: true });
    expect(nth(calls, 0).url.href).toBe('https://llm.local/v1/models'); // trailing slash trimmed
    expect(nth(calls, 0).headers['HTTP-Referer']).toBeUndefined();
  });
});

describe('JevAdapter (mocked TypeSafe System One)', () => {
  test('ask(): named questions in, keyed answers out, model defaults to config', async () => {
    const { calls } = mockFetch([
      [
        JEV,
        () =>
          json({
            model: 'jev-2026-09',
            answers: {
              spam: { type: 'noul', noul: 0.97 },
              tone: { type: 'choice', choice: 'angry', confidence: 0.8, probabilities: { angry: 0.8, calm: 0.2 } },
              urgency: { type: 'score', score: 1.7, confidence: 0.9 },
            },
            usage: { input_tokens: 120, output_tokens: 12 },
          }),
      ],
    ]);
    const res = await jev().ask('I was charged twice!', {
      spam: { type: 'noul', instructions: 'Is this spam?' },
      tone: { type: 'choice', criteria: { angry: null, calm: 'polite' } },
      urgency: { type: 'score', criteria: ['Can wait', 'Soon', 'Now'] },
    });
    expect(res.answers.spam).toEqual({ type: 'noul', noul: 0.97 });
    expect(res.answers.tone).toMatchObject({ choice: 'angry', confidence: 0.8 });
    expect(res.answers.urgency).toMatchObject({ score: 1.7 });
    expect(nth(calls, 0).url.href).toBe('https://api.typesafe.ai/v1/systemone');
    expect(nth(calls, 0).headers.Authorization).toBe('Bearer jev-test-key');
    expect(nth(calls, 0).body).toMatchObject({ model: 'jev-latest', state: 'I was charged twice!' });
  });

  test('ask(): empty answers → invalid_response; 422 validation detail is surfaced', async () => {
    mockFetch([[JEV, () => json({ model: 'jev-latest', answers: {}, usage: {} })]]);
    await expect(jev().ask('x', { q: { type: 'noul' } })).rejects.toMatchObject({ kind: 'invalid_response' });

    jest.restoreAllMocks();
    mockFetch([[JEV, () => json({ detail: [{ loc: ['body', 'questions'], msg: 'Field required' }] }, 422)]]);
    await expect(jev().ask('x', { q: { type: 'noul' } }, 'jev-preview')).rejects.toMatchObject({
      kind: 'bad_request',
      message: '[jev] HTTP 422: คำขอไม่ถูกต้อง — Field required',
    });
  });

  test('chat() is unsupported (router only) and makes no request', async () => {
    const { spy } = mockFetch([]);
    await expect(jev().chat(REQ)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('getModels / probe use GET /v1/models', async () => {
    const { calls } = mockFetch([
      [JEV, () => json({ models: [{ name: 'jev-latest', description: 'x', release_date: '2026-09-15' }, { name: 'jev-preview', description: 'y', release_date: '2026-10-01' }] })],
    ]);
    await expect(jev().getModels()).resolves.toEqual(['jev-latest', 'jev-preview']);
    await expect(jev().testConnection()).resolves.toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['GET /v1/models', 'GET /v1/models']);
  });

  test('TypeSafe auth error body ({detail:{message}}) is readable', async () => {
    mockFetch([[JEV, () => json({ detail: { error_type: 'authentication_error', message: 'Cannot authenticate with the server.' } }, 401)]]);
    await expect(jev().testConnection()).resolves.toEqual({
      ok: false,
      error: '[jev] HTTP 401: API key ไม่ถูกต้องหรือไม่มีสิทธิ์ — Cannot authenticate with the server.',
    });
  });

  test('server errors keep a raw text excerpt when the body is not JSON', async () => {
    mockFetch([[JEV, () => new Response('upstream timeout', { status: 504 })]]);
    await expect(jev().testConnection()).resolves.toEqual({
      ok: false,
      error: '[jev] HTTP 504: เซิร์ฟเวอร์ผู้ให้บริการขัดข้อง — upstream timeout',
    });
    jest.restoreAllMocks();
    mockFetch([[JEV, () => httpError(429, 'slow down')]]);
    await expect(jev().testConnection()).resolves.toMatchObject({ error: expect.stringContaining('rate limit') });
  });
});
