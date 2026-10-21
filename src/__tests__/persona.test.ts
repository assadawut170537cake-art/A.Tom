import * as Speech from 'expo-speech';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { registerAIProviders } from '../features/ai';
import { PERSONA_PROMPTS } from '../features/ai/prompts/personaPrompts';
import { PERSONA_GREETINGS } from '../features/jarvis/constants';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { registerVoiceProviders } from '../features/voice';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';

const geminiReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));

/** Gemini mock: classifier prompt → JSON label, anything else → `reply`. Records request bodies. */
function mockGemini(reply: string, intent = 'chat') {
  const bodies: { systemInstruction?: { parts: [{ text: string }] }; contents: unknown[] }[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const system = body.systemInstruction?.parts[0].text ?? '';
    return system.startsWith('Classify')
      ? geminiReply(JSON.stringify({ intent, confidence: 0.9 }))
      : geminiReply(reply);
  });
  return bodies;
}

const history = (p: 1 | 2 | 3 | 4) => useAtomStore.getState().messagesByPersona[p];

beforeAll(async () => {
  registerAIProviders();
  registerVoiceProviders();
  await SecureKeyStore.set('ai.gemini', 'test-key');
  await ProviderSettings.setEnabled('openrouter', false);
});

beforeEach(() => {
  useAtomStore.setState({ messagesByPersona: { 1: [], 2: [], 3: [], 4: [] } });
  useAtomStore.getState().setActivePersona(1);
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

test('switching persona swaps the system prompt and the voice', async () => {
  await ProviderSettings.setTTSFor(2, { providerId: 'expo', voiceId: 'th-TH-voice', speed: 1.1 });
  expect(useAtomStore.getState().systemPrompt).toContain(PERSONA_PROMPTS[1]);

  useAtomStore.getState().setActivePersona(2);
  expect(useAtomStore.getState().systemPrompt).toContain(PERSONA_PROMPTS[2]);
  await useAtomStore.getState().refreshVoice();
  expect(useAtomStore.getState().voice).toEqual({
    providerId: 'expo',
    voiceId: 'th-TH-voice',
    speed: 1.1,
  });
  // Switching away stops whatever the previous persona was still saying
  // Speech that never finishes on its own; like the real module, stop() fires onStopped
  jest.mocked(Speech.speak).mockImplementationOnce((_text, opts) => {
    jest.mocked(Speech.stop).mockImplementationOnce(async () => {
      (opts?.onStopped as (() => void) | undefined)?.();
    });
  });
  const speaking = voiceOrchestrator.speak('ยังพูดไม่จบ', 2);
  await new Promise((r) => setTimeout(r, 0));
  jest.mocked(Speech.stop).mockClear();
  useAtomStore.getState().setActivePersona(3);
  expect(Speech.stop).toHaveBeenCalledTimes(1);
  await speaking; // resolved by the stop
});

test('chat uses the persona prompt, keeps histories separate and speaks with the persona voice', async () => {
  await ProviderSettings.setTTSFor(2, { providerId: 'expo', voiceId: 'th-TH-voice' });
  useAtomStore.getState().setActivePersona(2);
  const bodies = mockGemini('สวัสดีครับบอส');

  const res = await sendMessage('วันนี้เป็นไงบ้าง');

  expect(res.reply).toBe('สวัสดีครับบอส');
  // คุยธรรมดา (ไม่มีคำใบ้คำสั่ง) → ไม่เสีย request ถามตัวแยกประเภท · ADR-017
  expect(res.route?.provider).toBe('rule');
  expect(bodies).toHaveLength(1);
  const chatBody = bodies.find((b) => !b.systemInstruction?.parts[0].text.startsWith('Classify'));
  expect(chatBody?.systemInstruction?.parts[0].text).toContain(PERSONA_PROMPTS[2]);

  expect(history(2).map((m) => [m.role, m.content])).toEqual([
    ['user', 'วันนี้เป็นไงบ้าง'],
    ['assistant', 'สวัสดีครับบอส'],
  ]);
  expect(history(1)).toHaveLength(0);
  expect(Speech.speak).toHaveBeenCalledWith(
    'สวัสดีครับบอส',
    expect.objectContaining({ voice: 'th-TH-voice', language: 'th-TH' })
  );
  expect(useAtomStore.getState().mood).toBe('idle');
});

test('"เรียกอัลตรอน" switches persona via the rule classifier (no network)', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');

  const res = await sendMessage('เรียกอัลตรอนมาหน่อย');

  expect(res.route).toMatchObject({ intent: 'switch_assistant', provider: 'rule' });
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(useAtomStore.getState().activePersona).toBe(4);
  expect(useAtomStore.getState().systemPrompt).toContain(PERSONA_PROMPTS[4]);
  // The request stays in ATOM's history; Ultron's greeting starts Ultron's
  expect(history(1).map((m) => m.role)).toEqual(['user']);
  expect(history(4).map((m) => m.content)).toEqual([PERSONA_GREETINGS[4]]);
});

test('provider failure surfaces as a system message and resets the orb', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

  const res = await sendMessage('ช่วยหน่อย');

  expect(res.error).toMatch(/ผู้ให้บริการทุกรายล้มเหลว/);
  expect(history(1).at(-1)?.role).toBe('system');
  expect(useAtomStore.getState().mood).toBe('idle');
});
