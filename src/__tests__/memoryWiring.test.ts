import AsyncStorage from '@react-native-async-storage/async-storage';

import { bootApp, startServices } from '../boot';
import { localMemory } from '../core/memory/LocalMemoryAdapter';
import { MEMORY_SUGGESTION_INSTRUCTION } from '../core/memory/suggestions';
import type { MemoryStore } from '../core/memory/types';
import { ModuleManager } from '../core/modules/ModuleManager';
import { ModuleRegistry } from '../core/modules/ModuleRegistry';
import { ALL_MEMORY_TARGETS } from '../core/memory/types';
import {
  DEV_TEST_FACTS,
  installMemoryDevTools,
  type AtomDevTools,
} from '../dev/memoryDevTools';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import { getPersonaPrompt } from '../features/ai/prompts/personaPrompts';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { createAppRouter, getAppRouter } from '../features/router/appRouter';
import { voiceRegistry } from '../features/voice/core/VoiceRegistry';
import { GEMINI, geminiText, isClassifierCall, mockFetch, type RecordedCall } from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
  resetStore();
  // localMemory is the app singleton: clear() also empties its in-memory mirror
  for (const target of ALL_MEMORY_TARGETS) await localMemory.clear(target);
  await AsyncStorage.clear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** Mocked Gemini: classifier → chat, chat → fixed reply. Returns the system prompt of each chat call. */
function captureSystemPrompts() {
  const { calls } = mockFetch([
    [GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat","confidence":0.9}') : geminiText('จำได้ครับ'))],
  ]);
  const systemOf = (c: RecordedCall) =>
    (c.body as { systemInstruction?: { parts: { text: string }[] } }).systemInstruction?.parts[0]?.text;
  return () => calls.filter((c) => !isClassifierCall(c)).map(systemOf);
}

describe('app chat path uses Shared Memory (sendMessage → app router → ChatHandler)', () => {
  test('B1: facts in localMemory are appended to the system prompt', async () => {
    await localMemory.save({ scope: 'global' }, 'drink', 'บอสชอบกาแฟดำ');
    await localMemory.save({ scope: 'persona', persona: 1 }, 'nickname', 'ลูกพี่เค้ก');
    await localMemory.save({ scope: 'persona', persona: 2 }, 'jarvis_only', 'ของจาร์วิส');
    const prompts = captureSystemPrompts();

    const res = await sendMessage('บอสชอบดื่มอะไร', { speak: false });

    expect(res.reply).toBe('จำได้ครับ');
    const [system] = prompts();
    expect(system).toMatch(new RegExp(`^${escape(getPersonaPrompt(1))}\\n\\nสิ่งที่จำได้เกี่ยวกับบอส:\\n`));
    expect(system).toContain('- drink: บอสชอบกาแฟดำ');
    expect(system).toContain('- nickname: ลูกพี่เค้ก');
    expect(system).not.toContain('ของจาร์วิส'); // another persona's private fact
  });

  test('B1: a fact saved after the first chat is used by the next one (no stale cache)', async () => {
    const prompts = captureSystemPrompts();
    await sendMessage('ข้อแรก', { speak: false });
    await localMemory.save({ scope: 'global' }, 'city', 'เชียงใหม่');
    await sendMessage('ข้อสอง', { speak: false });
    const [first, second] = prompts();
    expect(first).not.toContain('เชียงใหม่');
    expect(second).toContain('- city: เชียงใหม่');
  });

  test('B2: empty memory → persona prompt + คำสั่งเสนอความจำ (ไม่มีบล็อก facts)', async () => {
    const prompts = captureSystemPrompts();
    useAtomStore.getState().setActivePersona(3);
    await sendMessage('สวัสดี', { speak: false });
    expect(prompts()).toEqual([`${getPersonaPrompt(3)}\n\n${MEMORY_SUGGESTION_INSTRUCTION}`]);
  });

  test('B3: memory that throws → logged, chat still answers without facts', async () => {
    jest.spyOn(localMemory, 'list').mockRejectedValue(new Error('storage locked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const prompts = captureSystemPrompts();

    const res = await sendMessage('ยังคุยได้ไหม', { speak: false });

    expect(res).toMatchObject({ reply: 'จำได้ครับ' });
    expect(res.error).toBeUndefined();
    expect(prompts()).toEqual([`${getPersonaPrompt(1)}\n\n${MEMORY_SUGGESTION_INSTRUCTION}`]);
    expect(error).toHaveBeenCalledWith('[chat] อ่าน shared memory ไม่ได้ — ตอบโดยไม่ใช้ความจำ', expect.any(Error));
    expect(useAtomStore.getState().messagesByPersona[1].map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('getAppRouter is a singleton; createAppRouter can take another store', async () => {
    expect(getAppRouter()).toBe(getAppRouter());
    const other: MemoryStore = {
      save: jest.fn(),
      load: jest.fn(),
      list: async ({ scope }) =>
        scope === 'global' ? [{ id: '1', key: 'from', value: 'other store', source: 'user', createdAt: 1, updatedAt: 1 }] : [],
      remove: jest.fn(),
      clear: jest.fn(),
      sync: jest.fn(),
    };
    const prompts = captureSystemPrompts();
    await createAppRouter(other).handle({ text: 'x', context: { activePersona: 1 } });
    expect(prompts()[0]).toContain('- from: other store');
  });
});

describe('boot', () => {
  const newRegistry = () => new ModuleRegistry({ memory: localMemory, logger: { info: jest.fn(), error: jest.fn() } });
  const fakeDeps = (overrides: Partial<Parameters<typeof startServices>[0]> = {}) => ({
    modules: new ModuleManager(newRegistry()),
    memory: localMemory,
    dev: false,
    installDevTools: jest.fn(),
    ...overrides,
  });

  test('initialises modules and counts memory facts', async () => {
    await localMemory.save({ scope: 'global' }, 'a', '1');
    await localMemory.save({ scope: 'persona', persona: 4 }, 'b', '2');
    const modules = new ModuleManager(newRegistry());
    const init = jest.fn();
    await modules.register({ id: 'demo', name: 'Demo', enabled: true, init, dispose: jest.fn() });

    const report = await startServices(fakeDeps({ modules }));

    expect(init).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ modules: { ready: ['demo'], failed: [] }, memoryFacts: 2 });
  });

  test('module init blowing up never crashes boot', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const report = await startServices(
      fakeDeps({ modules: { start: () => Promise.reject(new Error('registry broken')) } })
    );
    expect(report.modules).toBeNull();
    expect(error).toHaveBeenCalledWith('[boot] เริ่ม module ไม่สำเร็จ — แอปทำงานต่อได้ (ไม่มี module)', expect.any(Error));
  });

  test('unreadable memory never crashes boot', async () => {
    jest.spyOn(localMemory, 'list').mockRejectedValue(new Error('locked'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(startServices(fakeDeps())).resolves.toMatchObject({ memoryFacts: null });
  });

  test('dev: logs the fact count and installs the memory dev tools; prod: neither', async () => {
    const installDevTools = jest.fn();
    await startServices(fakeDeps({ dev: true, installDevTools }));
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[boot\] Shared Memory: 0 facts/));
    expect(installDevTools).toHaveBeenCalledWith(localMemory);

    jest.mocked(console.info).mockClear();
    const prodInstall = jest.fn();
    await startServices(fakeDeps({ dev: false, installDevTools: prodInstall }));
    expect(console.info).not.toHaveBeenCalled();
    expect(prodInstall).not.toHaveBeenCalled();
  });

  test('a failing dev-tools install is logged, boot still resolves', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const installDevTools = () => {
      throw new Error('no DevSettings');
    };
    await expect(startServices(fakeDeps({ dev: true, installDevTools }))).resolves.toBeDefined();
    expect(error).toHaveBeenCalledWith('[boot] ติดตั้งเครื่องมือ dev ไม่ได้', expect.any(Error));
  });

  test('bootApp registers providers and is idempotent (same promise on fast refresh)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // real DevSettings under jest builds a NativeEventEmitter on an incomplete mock and warns — test-env noise only
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const first = bootApp();
    expect(bootApp()).toBe(first);
    await expect(first).resolves.toMatchObject({ modules: { ready: [], failed: [] } });
    expect(aiRegistry.get('gemini')).toBeDefined();
    expect(voiceRegistry.getTTS('gemini')).toBeDefined();
  });
});

describe('memory dev tools', () => {
  function install() {
    const items = new Map<string, () => void>();
    const tools = installMemoryDevTools(localMemory, {
      addMenuItem: (title: string, handler: () => void) => items.set(title, handler),
    });
    return { items, tools };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('dev menu items seed and clear only the test facts', async () => {
    await localMemory.save({ scope: 'global' }, 'real_fact', 'ของจริงของบอส');
    const { items } = install();
    expect([...items.keys()]).toEqual(['A.T.O.M.: เพิ่ม fact ทดสอบ', 'A.T.O.M.: ล้าง fact ทดสอบ']);

    items.get('A.T.O.M.: เพิ่ม fact ทดสอบ')?.();
    await flush();
    for (const f of DEV_TEST_FACTS) {
      await expect(localMemory.load(f.target, f.key)).resolves.toMatchObject({ value: f.value, source: 'system' });
    }

    items.get('A.T.O.M.: ล้าง fact ทดสอบ')?.();
    await flush();
    for (const f of DEV_TEST_FACTS) await expect(localMemory.load(f.target, f.key)).resolves.toBeNull();
    await expect(localMemory.load({ scope: 'global' }, 'real_fact')).resolves.toMatchObject({ value: 'ของจริงของบอส' });
  });

  test('atomDev is exposed on globalThis for the DevTools console', async () => {
    install();
    const { atomDev } = globalThis as unknown as { atomDev: AtomDevTools }; // test-only peek at the global
    await atomDev.seed();
    expect((await atomDev.list()).map((f) => f.key).sort()).toEqual(['dev_atom_nickname', 'dev_drink']);
    await atomDev.clear();
    expect(await atomDev.list()).toEqual([]);
  });

  test('seeded facts reach the chat prompt end to end', async () => {
    const { tools } = install();
    await tools.seed();
    const prompts = captureSystemPrompts();
    await sendMessage('บอสชอบดื่มอะไร', { speak: false });
    expect(prompts()[0]).toContain('- dev_drink: บอสชอบกาแฟดำ ไม่ใส่น้ำตาล');
    expect(prompts()[0]).toContain('- dev_atom_nickname: อะตอมเรียกบอสว่า "ลูกพี่เค้ก"');
  });

  test('a failing seed from the menu is logged, not thrown', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(localMemory, 'save').mockRejectedValueOnce(new Error('full'));
    const { items } = install();
    items.get('A.T.O.M.: เพิ่ม fact ทดสอบ')?.();
    await flush();
    expect(error).toHaveBeenCalledWith('[dev] เพิ่ม fact ทดสอบไม่สำเร็จ', expect.any(Error));
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
