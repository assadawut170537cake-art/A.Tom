import AsyncStorage from '@react-native-async-storage/async-storage';

import { ChatHistoryStorage, historyKey } from '../core/storage/ChatHistoryStorage';
import { readJSON, writeJSON } from '../core/storage/jsonStorage';
import { DEFAULT_ADVANCED, type ProviderSettingsStore } from '../core/storage/ProviderSettings';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import type { Persona } from '../features/jarvis/types';
import { isArrayOf, isRecord, isString, parseJSON } from '../core/types/guards';
import { resetStore } from '../test-utils/setup';

const SETTINGS_KEY = 'atom.providerSettings.v1';

/**
 * ProviderSettings caches the blob for the module's lifetime, so each corrupt-read scenario loads
 * a fresh copy of the module (and of the AsyncStorage mock it reads from).
 */
function freshSettings(): { settings: ProviderSettingsStore; storage: typeof AsyncStorage } {
  let settings: ProviderSettingsStore | undefined;
  let storage: typeof AsyncStorage | undefined;
  jest.isolateModules(() => {
    // isolateModules needs synchronous require(); dynamic import() is unavailable without
    // --experimental-vm-modules under jest-expo.
    /* eslint-disable @typescript-eslint/no-require-imports */
    // The jest mock is CommonJS (no `default`); the real package is ESM — accept either shape
    const mod = require('@react-native-async-storage/async-storage') as typeof AsyncStorage & {
      default?: typeof AsyncStorage;
    };
    storage = mod.default ?? mod;
    settings = (require('../core/storage/ProviderSettings') as { ProviderSettings: ProviderSettingsStore })
      .ProviderSettings;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  if (!settings || !storage) throw new Error('isolateModules did not load the modules');
  return { settings, storage };
}

let errorSpy: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('guards: JSON.parse failure scenarios', () => {
  test.each([
    ['truncated JSON', '{"enabled":{"gemini":true'],
    ['not JSON at all', 'undefined'],
    ['empty string', ''],
    ['HTML error page', '<html>500</html>'],
  ])('parseJSON never throws on %s', (_name, raw) => {
    expect(parseJSON(raw, isRecord)).toBeNull();
  });

  test('valid JSON of the wrong shape is rejected by the guard', () => {
    expect(parseJSON('[1,2]', isRecord)).toBeNull();
    expect(parseJSON('"text"', isRecord)).toBeNull();
    expect(parseJSON('null', isRecord)).toBeNull();
    expect(parseJSON('["a", 1]', (v): v is string[] => isArrayOf(v, isString))).toBeNull();
    expect(parseJSON(undefined, isRecord)).toBeNull();
  });
});

describe('jsonStorage', () => {
  test('round-trips typed values; missing key → null without logging', async () => {
    await writeJSON('k', { a: 1 });
    await expect(readJSON('k', isRecord)).resolves.toEqual({ a: 1 });
    await expect(readJSON('missing', isRecord)).resolves.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('corrupt value → null + console.error naming the key', async () => {
    await AsyncStorage.setItem('k', '{oops');
    await expect(readJSON('k', isRecord)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[storage] k: ข้อมูลเสีย'));
  });

  test('storage I/O errors propagate to the caller (who decides how to degrade)', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O'));
    await expect(readJSON('k', isRecord)).rejects.toThrow('disk I/O');
  });
});

describe('ProviderSettings: corrupt / unreadable storage', () => {
  test('malformed fields are dropped (defaults used), valid ones kept, and the drop is logged', async () => {
    const { settings, storage } = freshSettings();
    await storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        enabled: { gemini: 'yes' }, // not boolean
        priority: ['openrouter', 'gemini'], // valid
        models: { gemini: 42 }, // not string
        ttsByPersona: { 1: { providerId: 'azure', speed: 'fast' } }, // bad speed
        sameVoiceForAll: 'true', // not boolean
        sharedVoice: { voiceId: 'x' }, // no providerId
        stt: 7,
        advanced: { timeoutMs: '30s', retries: 2 },
        voiceEnabled: { tts: { openai: 1 } },
        voicePriority: { stt: 'whisper' },
        options: { 'tts.azure': { region: 1 } },
      })
    );

    expect(await settings.getPriority()).toEqual(['openrouter', 'gemini']);
    expect(await settings.getEnabled('gemini')).toBeUndefined();
    expect(await settings.getModelFor('gemini')).toBeUndefined();
    expect(await settings.getTTSFor(1)).toBeUndefined();
    expect(await settings.getSameVoiceForAll()).toBe(false);
    expect(await settings.getSTT()).toBeUndefined();
    expect(await settings.getAdvanced()).toEqual(DEFAULT_ADVANCED);
    expect(await settings.getVoiceEnabled('tts', 'openai')).toBe(true);
    expect(await settings.getVoicePriority('stt')).toEqual([]);
    expect(await settings.getOption('tts.azure', 'region')).toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0] as [string];
    expect(message).toMatch(/^\[settings\] ข้อมูลตั้งค่าเสีย/);
    for (const field of ['enabled', 'models', 'ttsByPersona', 'sameVoiceForAll', 'sharedVoice', 'stt', 'advanced', 'voiceEnabled', 'voicePriority', 'options']) {
      expect(message).toContain(field);
    }
    expect(message).not.toContain('priority,'); // the valid field is kept
    expect(settings.isPersistent()).toBe(true);
  });

  test('partially valid nested objects merge with defaults', async () => {
    const { settings, storage } = freshSettings();
    await storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ advanced: { retries: 2 }, voicePriority: { tts: ['google'] } })
    );
    expect(await settings.getAdvanced()).toEqual({ ...DEFAULT_ADVANCED, retries: 2 });
    expect(await settings.getVoicePriority('tts')).toEqual(['google']);
    expect(await settings.getVoicePriority('stt')).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['not JSON', '{"priority":['],
    ['a JSON array', '["gemini"]'],
    ['a JSON string', '"settings"'],
  ])('blob that is %s → all defaults + console.error, then the next write repairs it', async (_n, raw) => {
    const { settings, storage } = freshSettings();
    await storage.setItem(SETTINGS_KEY, raw);
    expect(await settings.getPriority()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ข้อมูลเสีย'));

    await settings.setPriority(['gemini']);
    expect(JSON.parse((await storage.getItem(SETTINGS_KEY)) ?? 'null')).toMatchObject({ priority: ['gemini'] });
  });

  test('read failure → in-memory defaults, flagged not persistent, app keeps working', async () => {
    const { settings, storage } = freshSettings();
    jest.mocked(storage.getItem).mockRejectedValueOnce(new Error('SQLITE_IOERR'));
    expect(await settings.getAdvanced()).toEqual(DEFAULT_ADVANCED);
    expect(settings.isPersistent()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[settings] อ่านการตั้งค่าไม่ได้'), expect.any(Error));

    await settings.setModelFor('gemini', 'gemini-3-pro'); // storage is back → persisted again
    expect(settings.isPersistent()).toBe(true);
    expect(await settings.getModelFor('gemini')).toBe('gemini-3-pro');
  });

  test('write failure never rejects: value kept in memory, flag cleared, later writes still run', async () => {
    const { settings, storage } = freshSettings();
    const setItem = jest.mocked(storage.setItem);
    setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(settings.setPriority(['openrouter'])).resolves.toBeUndefined();
    expect(await settings.getPriority()).toEqual(['openrouter']);
    expect(settings.isPersistent()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[settings] บันทึกการตั้งค่าไม่ได้'), expect.any(Error));

    // Before the fix a rejected write poisoned the chain and every later setter rejected too
    await expect(settings.setSameVoiceForAll(true)).resolves.toBeUndefined();
    expect(settings.isPersistent()).toBe(true);
    expect(JSON.parse((await storage.getItem(SETTINGS_KEY)) ?? 'null')).toMatchObject({
      priority: ['openrouter'],
      sameVoiceForAll: true,
    });
  });
});

describe('ChatHistoryStorage: corrupt / unreadable storage', () => {
  const msg = (persona: Persona, content: string) => ({
    id: `${persona}-${content}`,
    persona,
    role: 'user',
    content,
    createdAt: 1,
  });

  test('entry that is not JSON → that persona starts empty, others load, console.error', async () => {
    await AsyncStorage.setItem(historyKey(1), '[{"id":"1"');
    await AsyncStorage.setItem(historyKey(2), JSON.stringify([msg(2, 'ok')]));
    const { ok, histories } = await ChatHistoryStorage.loadAll();
    expect(ok).toBe(true);
    expect(histories[1]).toEqual([]);
    expect(histories[2].map((m) => m.content)).toEqual(['ok']);
    expect(errorSpy).toHaveBeenCalledWith(`[history] ${historyKey(1)}: ข้อมูลเสีย — ตัดทิ้งทั้งชุด`);
  });

  test('entry that is JSON but not an array → dropped as corrupt', async () => {
    await AsyncStorage.setItem(historyKey(3), JSON.stringify({ messages: [msg(3, 'x')] }));
    expect((await ChatHistoryStorage.loadAll()).histories[3]).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`${historyKey(3)}: ข้อมูลเสีย`));
  });

  test('invalid messages are cut out one by one; the count is logged', async () => {
    await AsyncStorage.setItem(
      historyKey(4),
      JSON.stringify([
        msg(4, 'keep 1'),
        { ...msg(4, 'bad role'), role: 'robot' },
        { ...msg(4, 'other persona'), persona: 1 },
        { ...msg(4, 'no time'), createdAt: 'yesterday' },
        null,
        'text',
        msg(4, 'keep 2'),
      ])
    );
    const { histories } = await ChatHistoryStorage.loadAll();
    expect(histories[4].map((m) => m.content)).toEqual(['keep 1', 'keep 2']);
    expect(errorSpy).toHaveBeenCalledWith(`[history] ${historyKey(4)}: ตัดข้อความที่เสียทิ้ง 5 รายการ`);
  });

  test('clean storage logs nothing', async () => {
    await AsyncStorage.setItem(historyKey(1), JSON.stringify([msg(1, 'hi')]));
    await ChatHistoryStorage.loadAll();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('multiGet failure → ok:false with empty histories + console.error', async () => {
    jest.mocked(AsyncStorage.multiGet).mockRejectedValueOnce(new Error('locked'));
    const res = await ChatHistoryStorage.loadAll();
    expect(res).toEqual({ ok: false, histories: { 1: [], 2: [], 3: [], 4: [] } });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[history] อ่านประวัติแชทไม่ได้'), expect.any(Error));
  });

  test('save failure → false + console.error; the queue keeps working afterwards', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('full'));
    await expect(ChatHistoryStorage.save(2, [])).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[history] บันทึกประวัติแชทของ persona 2 ไม่ได้'), expect.any(Error));
    await expect(ChatHistoryStorage.save(2, [])).resolves.toBe(true);
  });

  test('store: unreadable history → memory-only (historyPersisted=false), chat still works', async () => {
    resetStore();
    useAtomStore.setState({ historyLoaded: false });
    jest.mocked(AsyncStorage.multiGet).mockRejectedValueOnce(new Error('locked'));
    await useAtomStore.getState().loadHistory();
    expect(useAtomStore.getState()).toMatchObject({ historyLoaded: true, historyPersisted: false });
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ยังคุยได้' });
    expect(useAtomStore.getState().messagesByPersona[1].map((m) => m.content)).toEqual(['ยังคุยได้']);
  });
});
