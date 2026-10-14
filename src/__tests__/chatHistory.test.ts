import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { PERSONA_PROMPTS } from '../features/ai/prompts/personaPrompts';
import { PERSONA_GREETINGS } from '../features/jarvis/constants';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import type { Persona } from '../features/jarvis/types';
import {
  GEMINI,
  JEV,
  OPENROUTER,
  geminiText,
  httpError,
  isClassifierCall,
  jevChoice,
  mockFetch,
  openRouterText,
  type RecordedCall,
} from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const STORE_KEY = 'atom-store';

const history = (p: Persona) => useAtomStore.getState().messagesByPersona[p];
const roles = (p: Persona) => history(p).map((m) => [m.role, m.content]);

/** Gemini: classifier → chat intent; chat → numbered replies. Returns the recorded chat calls. */
function mockChatGemini() {
  let n = 0;
  const { calls } = mockFetch([
    [
      GEMINI,
      (c) =>
        isClassifierCall(c)
          ? geminiText('{"intent":"chat","confidence":0.9}')
          : geminiText(`reply ${++n}`),
    ],
  ]);
  return () => calls.filter((c) => !isClassifierCall(c));
}

const contentsOf = (call: RecordedCall) =>
  (call.body as { contents: { role: string; parts: { text: string }[] }[] }).contents.map((c) => [
    c.role,
    c.parts[0].text,
  ]);

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter', 'jev']);
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  resetStore();
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe('Store: separate history per persona', () => {
  test('pushMessage defaults to the active persona and can target another one', () => {
    const { pushMessage, setActivePersona } = useAtomStore.getState();
    const a = pushMessage({ role: 'user', content: 'to atom' });
    setActivePersona(2);
    const b = pushMessage({ role: 'assistant', content: 'from jarvis' });
    const c = pushMessage({ role: 'assistant', content: 'note for friday', persona: 3 });

    expect(a).toMatchObject({ persona: 1, role: 'user', content: 'to atom' });
    expect(b.persona).toBe(2);
    expect(c.persona).toBe(3);
    expect(roles(1)).toEqual([['user', 'to atom']]);
    expect(roles(2)).toEqual([['assistant', 'from jarvis']]);
    expect(roles(3)).toEqual([['assistant', 'note for friday']]);
    expect(history(4)).toEqual([]);
  });

  test('messages get unique ids and timestamps, in insertion order', () => {
    const { pushMessage } = useAtomStore.getState();
    const before = Date.now();
    const ids = Array.from({ length: 50 }, (_, i) => pushMessage({ role: 'user', content: `m${i}` }).id);
    expect(new Set(ids).size).toBe(50);
    expect(history(1).map((m) => m.content)).toEqual(ids.map((_, i) => `m${i}`));
    expect(history(1)[0].createdAt).toBeGreaterThanOrEqual(before);
  });

  test('switching persona back and forth never mixes or clears histories', () => {
    const s = useAtomStore.getState();
    s.pushMessage({ role: 'user', content: 'a1' });
    s.setActivePersona(4);
    s.pushMessage({ role: 'user', content: 'u1' });
    s.setActivePersona(1);
    s.pushMessage({ role: 'user', content: 'a2' });
    s.setActivePersona(4);
    expect(roles(1)).toEqual([
      ['user', 'a1'],
      ['user', 'a2'],
    ]);
    expect(roles(4)).toEqual([['user', 'u1']]);
  });
});

describe('Conversation: history goes to the right persona', () => {
  test('each persona sends only its own previous turns to the LLM', async () => {
    const chatCalls = mockChatGemini();
    await sendMessage('สวัสดีอะตอม', { speak: false });
    useAtomStore.getState().setActivePersona(2);
    await sendMessage('สวัสดีจาร์วิส', { speak: false });
    useAtomStore.getState().setActivePersona(1);
    await sendMessage('อะตอมจำได้ไหม', { speak: false });

    expect(roles(1)).toEqual([
      ['user', 'สวัสดีอะตอม'],
      ['assistant', 'reply 1'],
      ['user', 'อะตอมจำได้ไหม'],
      ['assistant', 'reply 3'],
    ]);
    expect(roles(2)).toEqual([
      ['user', 'สวัสดีจาร์วิส'],
      ['assistant', 'reply 2'],
    ]);

    const [first, second, third] = chatCalls();
    expect(contentsOf(first)).toEqual([['user', 'สวัสดีอะตอม']]);
    expect(contentsOf(second)).toEqual([['user', 'สวัสดีจาร์วิส']]); // nothing from ATOM
    expect(contentsOf(third)).toEqual([
      ['user', 'สวัสดีอะตอม'],
      ['model', 'reply 1'],
      ['user', 'อะตอมจำได้ไหม'],
    ]);
    const system = (c: RecordedCall) =>
      (c.body as { systemInstruction: { parts: { text: string }[] } }).systemInstruction.parts[0].text;
    expect(system(second)).toContain(PERSONA_PROMPTS[2]);
    expect(system(third)).toContain(PERSONA_PROMPTS[1]);
  });

  test('system/error messages stay in the transcript but are not sent as history', async () => {
    useAtomStore.getState().pushMessage({ role: 'system', content: '⚠️ old error' });
    const chatCalls = mockChatGemini();
    await sendMessage('ลองใหม่', { speak: false });
    expect(contentsOf(chatCalls()[0])).toEqual([['user', 'ลองใหม่']]);
    expect(history(1)[0].role).toBe('system');
  });

  test('switch via OpenRouter-classified intent: request stays with the old persona, greeting starts the new one', async () => {
    await ProviderSettings.setEnabled('gemini', false);
    mockFetch([[OPENROUTER, () => openRouterText('{"intent":"switch_assistant","confidence":0.9}')]]);

    const res = await sendMessage('ขอคุยกับไฟรเดย์หน่อย');

    expect(res.route).toMatchObject({ intent: 'switch_assistant', provider: 'llm', entities: { persona: '3' } });
    expect(useAtomStore.getState().activePersona).toBe(3);
    expect(roles(1)).toEqual([['user', 'ขอคุยกับไฟรเดย์หน่อย']]);
    expect(roles(3)).toEqual([['assistant', PERSONA_GREETINGS[3]]]);
    expect(Speech.speak).toHaveBeenCalledWith(PERSONA_GREETINGS[3], expect.anything());
  });

  test('pc_command via Jev: Phase 4 stub reply in the same persona history', async () => {
    await ProviderSettings.setEnabled('jev', true);
    mockFetch([[JEV, () => jevChoice('pc_command', 0.95)]]);
    useAtomStore.getState().setActivePersona(4);

    const res = await sendMessage('รันสคริปต์แบ็กอัพให้หน่อย', { speak: false });

    expect(res).toMatchObject({ reply: 'Phase 4 ครับ', route: { provider: 'jev' } });
    expect(roles(4)).toEqual([
      ['user', 'รันสคริปต์แบ็กอัพให้หน่อย'],
      ['assistant', 'Phase 4 ครับ'],
    ]);
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  test('blank input is ignored; errors land in the active persona as a system message', async () => {
    const { spy } = mockFetch([]);
    await expect(sendMessage('   ')).resolves.toEqual({ route: null, reply: '' });
    expect(spy).not.toHaveBeenCalled();
    expect(history(1)).toEqual([]);

    jest.restoreAllMocks();
    mockFetch([
      [GEMINI, () => httpError(500)],
      [OPENROUTER, () => httpError(503)],
    ]);
    useAtomStore.getState().setActivePersona(2);
    const res = await sendMessage('ช่วยหน่อย');
    expect(res.error).toMatch(/ผู้ให้บริการทุกรายล้มเหลว/);
    expect(roles(2).map(([r]) => r)).toEqual(['user', 'system']);
    expect(useAtomStore.getState()).toMatchObject({ mood: 'idle', uiMode: 'conversation' });
  });

  test('speech failure does not lose the text reply', async () => {
    mockChatGemini();
    jest.mocked(Speech.speak).mockImplementationOnce((_t, opts) => {
      (opts?.onError as ((e: Error) => void) | undefined)?.(new Error('tts engine busy'));
    });
    const res = await sendMessage('พูดหน่อย');
    expect(res.reply).toBe('reply 1');
    expect(roles(1).at(-1)).toEqual(['assistant', 'reply 1']);
  });
});

describe('Persistence (save / load)', () => {
  test('saved: active persona + UI mode; chat history is in-memory only (current design)', async () => {
    useAtomStore.getState().setActivePersona(3);
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ข้อความลับ' });
    useAtomStore.getState().setUIMode('conversation');

    await new Promise((r) => setTimeout(r, 0));
    const saved = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}');
    expect(saved.state).toEqual({ activePersona: 3, uiMode: 'conversation' });
    expect(JSON.stringify(saved)).not.toContain('ข้อความลับ');
  });

  test('load: rehydration restores persona + mode and re-derives prompt and voice', async () => {
    await ProviderSettings.setTTSFor(4, { providerId: 'expo', voiceId: 'ultron-voice' });
    await AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({ state: { activePersona: 4, uiMode: 'conversation' }, version: 1 })
    );

    await useAtomStore.persist.rehydrate();

    const s = useAtomStore.getState();
    expect(s.activePersona).toBe(4);
    expect(s.uiMode).toBe('conversation');
    expect(s.systemPrompt).toContain(PERSONA_PROMPTS[4]);
    await waitForVoice('ultron-voice');
  });

  test('load keeps the in-memory histories of every persona', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'still here', persona: 2 });
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ state: { activePersona: 1, uiMode: 'idle' }, version: 1 }));
    await useAtomStore.persist.rehydrate();
    expect(roles(2)).toEqual([['user', 'still here']]);
  });
});

async function waitForVoice(voiceId: string) {
  for (let i = 0; i < 20 && useAtomStore.getState().voice?.voiceId !== voiceId; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(useAtomStore.getState().voice).toEqual({ providerId: 'expo', voiceId });
}
