import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { PROVIDERS } from '../features/ai';
import { stripThinking } from '../features/ai/adapters/OpenAICompatibleAdapter';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import { DAHL_BASE_URL } from '../features/ai/providers.config';
import { ChatHandler } from '../features/router/handlers/ChatHandler';
import { GEMINI, geminiText, httpError, json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, setAIKeys } from '../test-utils/setup';

const DAHL = /inference\.dahl\.global/;
const DAHL_IDS = ['dahl-minimax', 'dahl-deepseek', 'dahl-glm'] as const;
const dahlText = (text: string, model = 'm') =>
  json({
    model,
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  });

beforeAll(registerAll);
beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini']);
  for (const id of DAHL_IDS) {
    await SecureKeyStore.delete(secretKey('ai', id));
    await ProviderSettings.setEnabled(id, false);
  }
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setLLMFor(p, undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Dahl providers', () => {
  test('3 โมเดล · OpenAI-compatible · ปิดไว้ก่อน · baseURL เดียวกัน', () => {
    const dahl = PROVIDERS.filter((p) => p.id.startsWith('dahl-'));
    expect(dahl.map((p) => [p.id, p.defaultModel])).toEqual([
      ['dahl-minimax', 'MiniMaxAI/MiniMax-M2.7'],
      ['dahl-deepseek', 'deepseek-ai/DeepSeek-V4-Flash-0731'],
      ['dahl-glm', 'zai-org/GLM-5.3-Flash'],
    ]);
    for (const p of dahl) {
      expect(p).toMatchObject({
        type: 'openai-compatible',
        baseURL: DAHL_BASE_URL,
        enabled: false,
        purpose: 'llm',
      });
    }
  });

  test('chat → POST /v1/chat/completions ด้วย key ของโมเดลนั้น + ตัด <think>', async () => {
    await SecureKeyStore.set(secretKey('ai', 'dahl-glm'), 'dahl_glm_key');
    const { calls } = mockFetch([[DAHL, () => dahlText('<think>คิดก่อน</think>สวัสดีครับบอส')]]);
    const res = await aiRegistry.get('dahl-glm')!.chat({
      model: 'zai-org/GLM-5.3-Flash',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
    expect(res.content).toBe('สวัสดีครับบอส');
    const call = nth(calls, 0);
    expect(call.url.href).toBe('https://inference.dahl.global/v1/chat/completions');
    expect(call.headers.Authorization).toBe('Bearer dahl_glm_key');
    expect(call.body).toMatchObject({ model: 'zai-org/GLM-5.3-Flash' });
  });

  test('สลับเองอัตโนมัติ: ตัวแรกล้ม (429) → ตัวถัดไปตอบ', async () => {
    for (const id of DAHL_IDS) {
      await SecureKeyStore.set(secretKey('ai', id), `${id}-key`);
      await ProviderSettings.setEnabled(id, true);
    }
    await ProviderSettings.setEnabled('gemini', false);
    await ProviderSettings.setEnabled('openrouter', false);
    await ProviderSettings.setPriority([...DAHL_IDS]);
    const { calls } = mockFetch([
      [
        DAHL,
        (call) =>
          call.headers.Authorization === 'Bearer dahl-minimax-key'
            ? httpError(429)
            : dahlText('จาก deepseek'),
      ],
    ]);
    const res = await new Orchestrator().chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res).toMatchObject({ content: 'จาก deepseek', providerId: 'dahl-deepseek' });
    expect(calls.map((c) => (c.body as { model: string }).model)).toEqual([
      'MiniMaxAI/MiniMax-M2.7',
      'deepseek-ai/DeepSeek-V4-Flash-0731',
    ]);
  });
});

describe('โมเดลต่อ persona', () => {
  test('get/set + ล้างกลับเป็นอัตโนมัติ', async () => {
    await ProviderSettings.setLLMFor(4, 'dahl-glm');
    expect(await ProviderSettings.getLLMFor(4)).toBe('dahl-glm');
    expect(await ProviderSettings.getLLMFor(1)).toBeUndefined();
    await ProviderSettings.setLLMFor(4, undefined);
    expect(await ProviderSettings.getLLMFor(4)).toBeUndefined();
  });

  test('ChatHandler: persona ที่ผูกไว้ใช้ตัวนั้นก่อน · persona อื่นยังอัตโนมัติ', async () => {
    await SecureKeyStore.set(secretKey('ai', 'dahl-minimax'), 'k');
    await ProviderSettings.setEnabled('dahl-minimax', true);
    await ProviderSettings.setLLMFor(4, 'dahl-minimax');
    const { hosts } = mockFetch([
      [DAHL, () => dahlText('อัลตรอนตอบ')],
      [GEMINI, () => geminiText('อะตอมตอบ')],
    ]);
    const handler = new ChatHandler(new Orchestrator(), () => undefined);

    const ultron = await handler.handle({ text: 'hi', context: { activePersona: 4 } });
    expect(ultron.reply).toBe('อัลตรอนตอบ');
    const atom = await handler.handle({ text: 'hi', context: { activePersona: 1 } });
    expect(atom.reply).toBe('อะตอมตอบ');
    expect(hosts()).toEqual(['inference.dahl.global', 'generativelanguage.googleapis.com']);
  });

  test('ตัวที่ผูกไว้ล้ม → fallback ไปตัวอื่น (ยังตอบได้)', async () => {
    await SecureKeyStore.set(secretKey('ai', 'dahl-minimax'), 'k');
    await ProviderSettings.setEnabled('dahl-minimax', true);
    await ProviderSettings.setLLMFor(2, 'dahl-minimax');
    mockFetch([
      [DAHL, () => httpError(503)],
      [GEMINI, () => geminiText('gemini รับช่วง')],
    ]);
    const res = await new ChatHandler(new Orchestrator(), () => undefined).handle({
      text: 'hi',
      context: { activePersona: 2 },
    });
    expect(res.reply).toBe('gemini รับช่วง');
  });

  test('อ่านค่าล้ม → อัตโนมัติ ไม่ throw', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch([[GEMINI, () => geminiText('ok')]]);
    const handler = new ChatHandler(
      new Orchestrator(),
      () => undefined,
      undefined,
      () => Promise.reject(new Error('storage')),
    );
    await expect(handler.handle({ text: 'hi' })).resolves.toMatchObject({ reply: 'ok' });
  });
});

describe('stripThinking', () => {
  test('ตัด <think> หลายช่วง · แท็กไม่ปิด = ทิ้งท้าย · ไม่มีแท็ก = เหมือนเดิม', () => {
    expect(stripThinking('<think>a</think>\nตอบ<THINK>b</THINK>!')).toBe('ตอบ!');
    expect(stripThinking('ตอบแล้ว <think>ค้างถูกตัด')).toBe('ตอบแล้ว');
    expect(stripThinking('  ปกติ  ')).toBe('  ปกติ  ');
    expect(stripThinking('{"final":"x"}')).toBe('{"final":"x"}');
  });
});
