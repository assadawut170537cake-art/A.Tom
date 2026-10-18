import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { startServices } from '../boot';
import { ProviderError, redactSecrets } from '../core/http/errors';
import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import { ModuleRegistry } from '../core/modules/ModuleRegistry';
import type { KeyStore } from '../core/storage/SecureKeyStore';
import { PC_COMMANDS, describeResult, resolveCommand, unsupportedReply } from '../features/pc-bridge/commands';
import { MemoryBusClient, parseTask, type BusTask } from '../features/pc-bridge/MemoryBusClient';
import {
  NOT_CONFIGURED_REPLY,
  PcBridgeModule,
  failureAdvice,
  type BusClient,
  type PcBridgeDeps,
} from '../features/pc-bridge/PcBridgeModule';
import {
  PC_BRIDGE_URL_KEY,
  createPcBridgeSettings,
  normalizeProjectUrl,
  type PcBridgeConfig,
} from '../features/pc-bridge/settings';
import { PcBridgeScreen } from '../features/settings/screens/PcBridgeScreen';
import { PCCommandHandler } from '../features/router/handlers/PCCommandHandler';
import { loadBootModules, loadModule, MODULE_LOADERS } from '../modules/loader';
import { json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';

const TOKEN = `atm_${'a1'.repeat(32)}`;
const CONFIG: PcBridgeConfig = { url: 'https://demo.supabase.co', anonKey: 'sb_publishable_test', token: TOKEN };
const SUPABASE = /demo\.supabase\.co/;
const TASK_ID = '1c986435-97ed-4fa3-bd9e-47729f99ee25';

function memoryKeyStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    set: async (k, v) => void map.set(k, v),
    get: async (k) => map.get(k) ?? null,
    delete: async (k) => void map.delete(k),
    has: async (k) => !!map.get(k),
  };
}

const task = (status: BusTask['status'], result: Record<string, unknown> = {}): BusTask => ({
  taskId: TASK_ID,
  instruction: 'RUN_DIAGNOSTICS',
  status,
  result,
  claimedBy: status === 'PENDING' ? null : 'MARK_55_PC',
});

afterEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('settings', () => {
  test('normalizeProjectUrl: https only, strips trailing slash, rejects paths', () => {
    expect(normalizeProjectUrl(' https://demo.supabase.co/ ')).toEqual({ url: 'https://demo.supabase.co' });
    expect(normalizeProjectUrl('http://demo.supabase.co')).toEqual({ error: expect.stringContaining('https://') });
    expect(normalizeProjectUrl('https://demo.supabase.co/rest/v1')).toEqual({ error: expect.stringContaining('/rest/v1') });
    expect(normalizeProjectUrl('ไม่ใช่ url')).toEqual({ error: expect.stringContaining('ไม่ถูกต้อง') });
  });

  test('URL in AsyncStorage, key + token only in the secure store; load needs all three', async () => {
    const secrets = memoryKeyStore();
    const store = createPcBridgeSettings(secrets);
    expect(await store.load()).toBeNull();

    await store.save(CONFIG);
    expect(await AsyncStorage.getItem(PC_BRIDGE_URL_KEY)).toBe(CONFIG.url);
    expect([...secrets.map.values()]).toEqual([CONFIG.anonKey, TOKEN]);
    expect(await store.load()).toEqual(CONFIG);

    await secrets.delete('pcbridge.token');
    expect(await store.load()).toBeNull();

    await store.clear();
    expect(secrets.map.size).toBe(0);
    expect(await AsyncStorage.getItem(PC_BRIDGE_URL_KEY)).toBeNull();
  });

  test('device tokens are redacted from error text', () => {
    expect(redactSecrets(`token ${TOKEN} ผิด`)).toBe('token [REDACTED] ผิด');
  });
});

describe('MemoryBusClient', () => {
  test('submitTask posts to the RPC with the publishable key (no Bearer) and returns the id', async () => {
    const { calls } = mockFetch([[SUPABASE, () => json(TASK_ID)]]);
    await expect(new MemoryBusClient(CONFIG).submitTask('RUN_DIAGNOSTICS', { text: 'x' })).resolves.toBe(TASK_ID);
    const call = nth(calls, 0);
    expect(call.url.href).toBe('https://demo.supabase.co/rest/v1/rpc/mobile_submit_task');
    expect(call.method).toBe('POST');
    expect(call.headers.apikey).toBe('sb_publishable_test');
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body).toEqual({ p_token: TOKEN, p_instruction: 'RUN_DIAGNOSTICS', p_payload: { text: 'x' } });
  });

  test('legacy JWT anon key is also sent as Bearer', async () => {
    const { calls } = mockFetch([[SUPABASE, () => json(null)]]);
    await new MemoryBusClient({ ...CONFIG, anonKey: 'eyJhbGciOi.test' }).getTask(TASK_ID);
    expect(nth(calls, 0).headers.Authorization).toBe('Bearer eyJhbGciOi.test');
    expect(nth(calls, 0).body).toEqual({ p_token: TOKEN, p_task_id: TASK_ID });
  });

  test('getTask parses the row; null stays null; 403 → auth ProviderError', async () => {
    mockFetch([
      [
        SUPABASE,
        () => json({ task_id: TASK_ID, instruction: 'RUN_DIAGNOSTICS', status: 'COMPLETED', result: { status: 'HEALTHY' }, claimed_by: 'MARK_55_PC' }),
      ],
    ]);
    await expect(new MemoryBusClient(CONFIG).getTask(TASK_ID)).resolves.toEqual(task('COMPLETED', { status: 'HEALTHY' }));

    jest.restoreAllMocks();
    mockFetch([[SUPABASE, () => json({ code: 'PT403', message: 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' }, 403)]]);
    await expect(new MemoryBusClient(CONFIG).getTask(TASK_ID)).rejects.toMatchObject({ kind: 'auth', status: 403 });
  });

  test('parseTask rejects malformed rows', () => {
    expect(parseTask(null)).toBeNull();
    expect(() => parseTask({ task_id: TASK_ID, status: 'DONE' })).toThrow(ProviderError);
    expect(() => parseTask('x')).toThrow('ข้อมูลงาน');
  });
});

describe('commands', () => {
  test.each([
    ['สั่งคอมเช็กสถานะเครื่อง', 'RUN_DIAGNOSTICS'],
    ['ตรวจสุขภาพเครื่องหน่อย', 'RUN_DIAGNOSTICS'],
    ['สั่งคอม build โปรเจกต์', 'EXECUTE_BUILD'],
    ['สั่งเครื่องบิลด์ให้หน่อย', 'EXECUTE_BUILD'],
  ])('%s → %s', (text, instruction) => {
    expect(resolveCommand({ text })?.spec.instruction).toBe(instruction);
    expect(resolveCommand({ text })?.payload).toEqual({ text, source: 'atom-mobile' });
  });

  test('unknown command → null; reply lists what is supported', () => {
    expect(resolveCommand({ text: 'ปิดคอม' })).toBeNull();
    expect(unsupportedReply()).toContain(PC_COMMANDS.map((c) => c.label).join(' · '));
  });

  test('payload text is capped', () => {
    const resolved = resolveCommand({ text: `เช็ก${'ก'.repeat(1000)}` });
    expect(String(resolved?.payload.text)).toHaveLength(500);
  });

  test('describeResult: success shows status + extras, failure shows the exception', () => {
    expect(describeResult(task('COMPLETED', { status: 'HEALTHY', task_id: TASK_ID, cpu: 12 }), 'เช็กเครื่อง')).toBe(
      'Mark 55 ทำ "เช็กเครื่อง" เสร็จแล้ว — HEALTHY (cpu: 12)'
    );
    expect(describeResult(task('FAILED', { exception: 'ValueError: boom' }), 'บิลด์')).toBe(
      'Mark 55 ทำ "บิลด์" ไม่สำเร็จ: ValueError: boom'
    );
  });
});

describe('PcBridgeModule', () => {
  function bridge(client: Partial<BusClient>, deps: Partial<PcBridgeDeps> = {}) {
    const full: BusClient = {
      submitTask: jest.fn(async () => TASK_ID),
      getTask: jest.fn(async () => task('PENDING')),
      ...client,
    };
    const module = new PcBridgeModule({
      settings: { load: async () => CONFIG },
      createClient: () => full,
      sleep: async () => {},
      waitMs: 3,
      pollMs: 1,
      ...deps,
    });
    return { module, client: full };
  }

  test('not configured → tells Boss where to set it up, sends nothing', async () => {
    const { module, client } = bridge({}, { settings: { load: async () => null } });
    await expect(module.execute({ text: 'เช็กเครื่อง' })).resolves.toEqual({ reply: NOT_CONFIGURED_REPLY });
    expect(client.submitTask).not.toHaveBeenCalled();
  });

  test('unknown command → supported list, sends nothing', async () => {
    const { module, client } = bridge({});
    await expect(module.execute({ text: 'ปิดคอม' })).resolves.toEqual({ reply: unsupportedReply() });
    expect(client.submitTask).not.toHaveBeenCalled();
  });

  test('result arrives while waiting → answered in chat', async () => {
    const getTask = jest
      .fn<Promise<BusTask | null>, [string]>()
      .mockResolvedValueOnce(task('IN_PROGRESS'))
      .mockResolvedValueOnce(task('COMPLETED', { status: 'HEALTHY' }));
    const { module, client } = bridge({ getTask });
    await expect(module.execute({ text: 'สั่งคอมเช็กสถานะ' })).resolves.toEqual({
      reply: 'Mark 55 ทำ "เช็กเครื่อง" เสร็จแล้ว — HEALTHY',
    });
    expect(client.submitTask).toHaveBeenCalledWith('RUN_DIAGNOSTICS', { text: 'สั่งคอมเช็กสถานะ', source: 'atom-mobile' });
    expect(getTask).toHaveBeenCalledWith(TASK_ID);
  });

  test('Mark 55 never picks it up → "sent" with short id; claimed but unfinished → "working on it"', async () => {
    const { module } = bridge({});
    await expect(module.execute({ text: 'เช็กเครื่อง' })).resolves.toEqual({
      reply: 'ส่งงาน "เช็กเครื่อง" ให้ Mark 55 แล้ว (รหัส 1c986435) · Mark 55 ยังไม่รับงาน (อาจปิดเครื่องอยู่) — เปิดเมื่อไหร่จะทำต่อให้เองครับ',
    });
    const busy = bridge({ getTask: async () => task('IN_PROGRESS') }).module;
    await expect(busy.execute({ text: 'เช็กเครื่อง' })).resolves.toMatchObject({ reply: expect.stringContaining('กำลังทำอยู่') });
  });

  test('submit rejected → Thai advice, never a thrown ProviderError', async () => {
    const { module } = bridge({
      submitTask: async () => Promise.reject(new ProviderError('pc-bridge', 'auth', 'HTTP 403', 403)),
    });
    await expect(module.execute({ text: 'เช็กเครื่อง' })).resolves.toEqual({
      reply: expect.stringMatching(/^ส่งงาน "เช็กเครื่อง" ไม่สำเร็จ — token เครื่อง.*ตั้งค่า › Mark 55 Bus$/),
    });
  });

  test('polling fails after submit → says it was sent but the result is unreadable', async () => {
    const { module } = bridge({ getTask: async () => Promise.reject(new ProviderError('pc-bridge', 'network', 'x')) });
    await expect(module.execute({ text: 'เช็กเครื่อง' })).resolves.toMatchObject({
      reply: expect.stringContaining('แล้ว (รหัส 1c986435) แต่อ่านผลไม่ได้ — เชื่อมต่อ Supabase ไม่ได้'),
    });
  });

  test('failureAdvice per error kind', () => {
    expect(failureAdvice(new ProviderError('pc-bridge', 'rate_limit', 'x'))).toContain('ถี่เกินไป');
    expect(failureAdvice(new ProviderError('pc-bridge', 'timeout', 'x'))).toContain('อินเทอร์เน็ต');
    expect(failureAdvice(new ProviderError('pc-bridge', 'server', 'x'))).toContain('ขัดข้อง');
    expect(failureAdvice(new ProviderError('pc-bridge', 'bad_request', 'HTTP 400: payload ผิด'))).toBe('HTTP 400: payload ผิด');
    expect(failureAdvice(new Error('boom'))).toBe('boom');
  });

  test('end to end through PCCommandHandler over fetch', async () => {
    const registry = new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } });
    registry.register(
      new PcBridgeModule({ settings: { load: async () => CONFIG }, sleep: async () => {}, waitMs: 1, pollMs: 1 })
    );
    mockFetch([
      [/mobile_submit_task/, () => json(TASK_ID)],
      [/mobile_get_task/, () => json({ task_id: TASK_ID, status: 'COMPLETED', result: { status: 'BUILD_OK' } })],
    ]);
    await expect(
      new PCCommandHandler(registry).handle({ text: 'สั่งคอม build', context: { activePersona: 2 } })
    ).resolves.toEqual({ reply: 'Mark 55 ทำ "บิลด์" เสร็จแล้ว — BUILD_OK', persona: 2 });
  });
});

describe('loader + boot', () => {
  // Jest (babel-preset-expo) ไม่แปลง import() แบบ dynamic — ทดสอบด้วย factory ที่คืน module ตัวเดียวกัน
  const loaders = { 'pc-bridge': async () => new PcBridgeModule() };

  test('pc-bridge is in the app loader table and registers enabled under its id', async () => {
    expect(Object.keys(MODULE_LOADERS)).toEqual(['pc-bridge']);
    const registry = new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } });
    const module = await loadModule('pc-bridge', registry, loaders);
    expect(module.id).toBe('pc-bridge');
    expect(registry.isEnabled('pc-bridge')).toBe(true);
  });

  test('loadBootModules logs a failing loader and keeps going', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const registry = new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } });
    await loadBootModules(registry, { broken: () => Promise.reject(new Error('x')), ...loaders }, ['broken', 'pc-bridge']);
    expect(error).toHaveBeenCalledWith('[modules] โหลด "broken" ตอนเปิดแอปไม่สำเร็จ', expect.any(Error));
    expect(registry.has('pc-bridge')).toBe(true);
  });

  test('boot loads modules before starting them, and survives a loader crash', async () => {
    const order: string[] = [];
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await startServices({
      modules: { start: async () => (order.push('start'), { ready: [], failed: [] }) },
      memory: new LocalMemoryAdapter(),
      dev: false,
      installDevTools: jest.fn(),
      loadModules: async () => {
        order.push('load');
        throw new Error('boom');
      },
    });
    expect(order).toEqual(['load', 'start']);
    expect(error).toHaveBeenCalledWith('[boot] โหลด module ไม่สำเร็จ', expect.any(Error));
  });
});

describe('PcBridgeScreen', () => {
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));

  test('validates, saves, and hides saved secrets', async () => {
    const store = createPcBridgeSettings(memoryKeyStore());
    await render(<PcBridgeScreen settings={store} />);
    await settle();

    await fireEvent.changeText(screen.getByLabelText('Project URL'), 'http://demo.supabase.co');
    await fireEvent.press(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('Project URL ต้องขึ้นต้นด้วย https://')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Project URL'), 'https://demo.supabase.co/');
    await fireEvent.changeText(screen.getByLabelText('anon key'), 'sb_publishable_test');
    await fireEvent.changeText(screen.getByLabelText('Token เครื่อง'), 'atm_short');
    await fireEvent.press(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText(/token เครื่องต้องขึ้นต้นด้วย atm_/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Token เครื่อง'), TOKEN);
    await fireEvent.press(screen.getByRole('button', { name: 'บันทึก' }));
    await settle();
    expect(await store.load()).toEqual(CONFIG);
    expect(screen.getByLabelText('Token เครื่อง').props.value).toBe('');
    expect(screen.getByRole('button', { name: 'ลบการเชื่อมต่อ' })).toBeTruthy();
  });

  test('test button probes with the saved config and shows Thai advice on failure', async () => {
    const store = createPcBridgeSettings(memoryKeyStore());
    await store.save(CONFIG);
    const probe = jest
      .fn<Promise<unknown>, [PcBridgeConfig]>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new ProviderError('pc-bridge', 'auth', 'HTTP 403', 403));
    await render(<PcBridgeScreen settings={store} probe={probe} />);
    await settle();

    await fireEvent.press(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }));
    expect(await screen.findByText('เชื่อมต่อได้ — token ใช้งานได้')).toBeTruthy();
    expect(probe).toHaveBeenCalledWith(CONFIG);

    await fireEvent.press(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }));
    expect(await screen.findByText(/token เครื่องหรือ anon key ไม่ถูกต้อง/)).toBeTruthy();
  });
});
