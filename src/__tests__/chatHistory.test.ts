import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

import {
  ChatHistoryStorage,
  MAX_STORED_MESSAGES,
  historyKey,
} from '../core/storage/ChatHistoryStorage';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { PERSONA_PROMPTS } from '../features/ai/prompts/personaPrompts';
import { PERSONA_GREETINGS } from '../features/jarvis/constants';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import type { Message, Persona } from '../features/jarvis/types';
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
import { nth } from '../test-utils/nth';

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
  (call.body as { contents: { role: string; parts: [{ text: string }] }[] }).contents.map((c) => [
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
    expect(nth(history(1), 0).createdAt).toBeGreaterThanOrEqual(before);
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

    const chat = chatCalls();
    const [first, second, third] = [nth(chat, 0), nth(chat, 1), nth(chat, 2)];
    expect(contentsOf(first)).toEqual([['user', 'สวัสดีอะตอม']]);
    expect(contentsOf(second)).toEqual([['user', 'สวัสดีจาร์วิส']]); // nothing from ATOM
    expect(contentsOf(third)).toEqual([
      ['user', 'สวัสดีอะตอม'],
      ['model', 'reply 1'],
      ['user', 'อะตอมจำได้ไหม'],
    ]);
    const system = (c: RecordedCall) =>
      (c.body as { systemInstruction: { parts: [{ text: string }] } }).systemInstruction.parts[0].text;
    expect(system(second)).toContain(PERSONA_PROMPTS[2]);
    expect(system(third)).toContain(PERSONA_PROMPTS[1]);
  });

  test('system/error messages stay in the transcript but are not sent as history', async () => {
    useAtomStore.getState().pushMessage({ role: 'system', content: '⚠️ old error' });
    const chatCalls = mockChatGemini();
    await sendMessage('ลองใหม่', { speak: false });
    expect(contentsOf(nth(chatCalls(), 0))).toEqual([['user', 'ลองใหม่']]);
    expect(nth(history(1), 0).role).toBe('system');
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

describe('Persistence: chat history (save / load)', () => {
  const stored = async (p: Persona) =>
    JSON.parse((await AsyncStorage.getItem(historyKey(p))) ?? 'null') as Message[] | null;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    await AsyncStorage.clear();
    useAtomStore.setState({ historyLoaded: true, historyPersisted: true });
  });

  test('saves after every message, one key per persona', async () => {
    const s = useAtomStore.getState();
    s.pushMessage({ role: 'user', content: 'a1' });
    s.pushMessage({ role: 'assistant', content: 'a2' });
    s.pushMessage({ role: 'user', content: 'u1', persona: 4 });
    await flush();

    expect((await stored(1))?.map((m) => m.content)).toEqual(['a1', 'a2']);
    expect((await stored(4))?.map((m) => m.content)).toEqual(['u1']);
    expect(await stored(2)).toBeNull(); // untouched personas are not written
    expect((await stored(1))?.[0]).toMatchObject({ persona: 1, role: 'user', id: expect.any(String) });
  });

  test('rapid writes land in order (last write has every message)', async () => {
    for (let i = 0; i < 30; i++) useAtomStore.getState().pushMessage({ role: 'user', content: `m${i}` });
    await flush();
    expect((await stored(1))?.map((m) => m.content)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
  });

  test('a full conversation turn (user + reply) is persisted for that persona', async () => {
    mockChatGemini();
    useAtomStore.getState().setActivePersona(2);
    await sendMessage('จำฉันได้ไหม', { speak: false });
    await flush();
    expect((await stored(2))?.map((m) => [m.role, m.content])).toEqual([
      ['user', 'จำฉันได้ไหม'],
      ['assistant', 'reply 1'],
    ]);
  });

  test('loads saved histories on app start', async () => {
    const msg = (persona: Persona, content: string, role = 'user') => ({
      id: `${persona}-${content}`, persona, role, content, createdAt: 1,
    });
    await AsyncStorage.setItem(historyKey(1), JSON.stringify([msg(1, 'old atom'), msg(1, 'reply', 'assistant')]));
    await AsyncStorage.setItem(historyKey(3), JSON.stringify([msg(3, 'old friday')]));
    useAtomStore.setState({ historyLoaded: false, messagesByPersona: { 1: [], 2: [], 3: [], 4: [] } });

    await useAtomStore.getState().loadHistory();

    expect(roles(1)).toEqual([['user', 'old atom'], ['assistant', 'reply']]);
    expect(roles(3)).toEqual([['user', 'old friday']]);
    expect(history(2)).toEqual([]);
    expect(useAtomStore.getState()).toMatchObject({ historyLoaded: true, historyPersisted: true });
  });

  test('messages pushed before loading finished are kept, merged after saved ones and saved', async () => {
    await AsyncStorage.setItem(
      historyKey(1),
      JSON.stringify([{ id: 'old', persona: 1, role: 'user', content: 'saved', createdAt: 1 }])
    );
    useAtomStore.setState({ historyLoaded: false, messagesByPersona: { 1: [], 2: [], 3: [], 4: [] } });
    useAtomStore.getState().pushMessage({ role: 'user', content: 'early' });
    await flush();
    // not written yet: would have overwritten the saved history
    expect((await stored(1))?.map((m) => m.content)).toEqual(['saved']);

    await useAtomStore.getState().loadHistory();
    await flush();
    expect(roles(1).map(([, c]) => c)).toEqual(['saved', 'early']);
    expect((await stored(1))?.map((m) => m.content)).toEqual(['saved', 'early']);

    // loading twice does not duplicate anything
    await useAtomStore.getState().loadHistory();
    expect(roles(1).map(([, c]) => c)).toEqual(['saved', 'early']);
  });

  test('corrupt / invalid / foreign entries are dropped on load', async () => {
    await AsyncStorage.setItem(historyKey(1), '{not json');
    await AsyncStorage.setItem(
      historyKey(2),
      JSON.stringify([
        { id: 'ok', persona: 2, role: 'assistant', content: 'valid', createdAt: 1 },
        { id: 'x', persona: 3, role: 'user', content: 'wrong persona', createdAt: 1 },
        { id: 'y', persona: 2, role: 'robot', content: 'bad role', createdAt: 1 },
        { persona: 2, role: 'user', content: 'no id', createdAt: 1 },
        null,
      ])
    );
    await AsyncStorage.setItem(historyKey(4), JSON.stringify({ not: 'an array' }));
    useAtomStore.setState({ historyLoaded: false, messagesByPersona: { 1: [], 2: [], 3: [], 4: [] } });

    await useAtomStore.getState().loadHistory();

    expect(history(1)).toEqual([]);
    expect(roles(2)).toEqual([['assistant', 'valid']]);
    expect(history(4)).toEqual([]);
    expect(useAtomStore.getState().historyPersisted).toBe(true);
  });

  test('storage read error → app keeps working in memory', async () => {
    jest.mocked(AsyncStorage.multiGet).mockRejectedValueOnce(new Error('disk I/O'));
    useAtomStore.setState({ historyLoaded: false });

    await useAtomStore.getState().loadHistory();

    expect(useAtomStore.getState()).toMatchObject({ historyLoaded: true, historyPersisted: false });
    useAtomStore.getState().pushMessage({ role: 'user', content: 'still works' });
    expect(roles(1)).toEqual([['user', 'still works']]);
  });

  test('storage write error → message stays in memory, store flags memory-only', async () => {
    // Fail only history writes (zustand's own 'atom-store' write must keep working). setItem is
    // already a jest.fn in the AsyncStorage mock, so restore its implementation explicitly.
    const setItem = jest.mocked(AsyncStorage.setItem);
    const original = setItem.getMockImplementation()!;
    setItem.mockImplementation((key, value) =>
      key.startsWith('atom.history.') ? Promise.reject(new Error('quota exceeded')) : original(key, value)
    );
    try {
      useAtomStore.getState().pushMessage({ role: 'user', content: 'not saved' });
      await flush();
      await flush();
      expect(roles(1)).toEqual([['user', 'not saved']]);
      expect(useAtomStore.getState().historyPersisted).toBe(false);
    } finally {
      setItem.mockImplementation(original);
    }
  });

  test(`only the newest ${MAX_STORED_MESSAGES} messages per persona are stored`, async () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 20 }, (_, i) => ({
      id: `m${i}`, persona: 1 as const, role: 'user' as const, content: `m${i}`, createdAt: i,
    }));
    await expect(ChatHistoryStorage.save(1, many)).resolves.toBe(true);
    const saved = await stored(1);
    expect(saved).toHaveLength(MAX_STORED_MESSAGES);
    expect(saved?.[0]?.content).toBe('m20');
  });

  test('persona/UI-mode store key stays separate from history keys', async () => {
    useAtomStore.getState().setActivePersona(3);
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ข้อความ' });
    useAtomStore.getState().setUIMode('conversation');
    await flush();
    const saved = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '{}');
    expect(saved.state).toEqual({ activePersona: 3, uiMode: 'conversation' });
    expect((await stored(3))?.map((m) => m.content)).toEqual(['ข้อความ']);
  });
});

describe('Persistence: persona + mode rehydration', () => {
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

  test('rehydrating persona/mode does not touch in-memory histories', async () => {
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
