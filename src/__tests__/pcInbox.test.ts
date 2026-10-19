import type { AgentToolCall, AgentToolResult } from '../core/agent/types';
import { deviceControl } from '../core/agent/DeviceControlBridge';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { MemoryBusClient, parseInbox, type InboxTask } from '../features/pc-bridge/MemoryBusClient';
import {
  MAX_NOTIFY_LENGTH,
  PcInbox,
  type InboxClient,
  type PcInboxDeps,
} from '../features/pc-bridge/PcInbox';
import type { PcBridgeConfig } from '../features/pc-bridge/settings';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { startServices } from '../boot';
import { deviceConfirmations } from '../modules/agents/confirmations';
import { appInboxHandlers, NOTIFY_PREFIX } from '../modules/pc-inbox';
import { json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';

const CONFIG: PcBridgeConfig = {
  url: 'https://abc.supabase.co',
  anonKey: 'sb_publishable_test',
  token: `atm_${'a'.repeat(64)}`,
};
const SUPABASE = /abc\.supabase\.co/;

const task = (
  instruction: string,
  payload: Record<string, unknown> = {},
  taskId = 't1',
): InboxTask => ({
  taskId,
  instruction,
  sender: 'MARK_55_PC',
  payload,
});

afterEach(() => jest.restoreAllMocks());

describe('MemoryBusClient — inbox RPC', () => {
  test('claimInbox ส่ง token + limit · แปลงแถว', async () => {
    const { calls } = mockFetch([
      [
        SUPABASE,
        () =>
          json([
            {
              task_id: 't1',
              instruction: 'NOTIFY',
              sender: 'MARK_55_PC',
              payload: { text: 'hi' },
              created_at: 'x',
            },
          ]),
      ],
    ]);
    await expect(new MemoryBusClient(CONFIG).claimInbox(5)).resolves.toEqual([
      { taskId: 't1', instruction: 'NOTIFY', sender: 'MARK_55_PC', payload: { text: 'hi' } },
    ]);
    const call = nth(calls, 0);
    expect(call.url.pathname).toBe('/rest/v1/rpc/mobile_claim_inbox');
    expect(call.body).toEqual({ p_token: CONFIG.token, p_limit: 5 });
  });

  test('finishTask ส่งผล · คืน true/false ตาม RPC', async () => {
    const { calls } = mockFetch([[SUPABASE, () => json(true)]]);
    await expect(new MemoryBusClient(CONFIG).finishTask('t1', true, { shown: true })).resolves.toBe(
      true,
    );
    expect(nth(calls, 0).url.pathname).toBe('/rest/v1/rpc/mobile_finish_task');
    expect(nth(calls, 0).body).toEqual({
      p_token: CONFIG.token,
      p_task_id: 't1',
      p_ok: true,
      p_result: { shown: true },
    });
  });

  test('parseInbox: ไม่ใช่ array = throw · แถวเสียถูกข้าม', () => {
    expect(() => parseInbox({})).toThrow('inbox');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseInbox([{ task_id: 1 }, { task_id: 'ok', instruction: 'NOTIFY' }])).toEqual([
      { taskId: 'ok', instruction: 'NOTIFY', sender: '', payload: {} },
    ]);
  });
});

describe('PcInbox', () => {
  function setup(tasks: InboxTask[], overrides: Partial<PcInboxDeps> = {}) {
    const client: InboxClient & { finishTask: jest.Mock; claimInbox: jest.Mock } = {
      claimInbox: jest.fn(async () => tasks),
      finishTask: jest.fn(async () => true),
    };
    const handlers = {
      notify: jest.fn(),
      deviceTool: jest.fn(async (_c: AgentToolCall): Promise<AgentToolResult> => ({
        ok: true,
        output: 'ตั้งเสียงเป็น 30% แล้ว',
      })),
    };
    const inbox = new PcInbox({
      settings: { load: async () => CONFIG },
      createClient: () => client,
      handlers,
      ...overrides,
    });
    return { inbox, client, handlers };
  }

  test('ยังไม่ตั้งค่า → ไม่เรียก Supabase', async () => {
    const createClient = jest.fn();
    const { inbox } = setup([], { settings: { load: async () => null }, createClient });
    await expect(inbox.pollOnce()).resolves.toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  test('NOTIFY → แสดง + พูด (ค่าเริ่มต้น) · ส่งผล COMPLETED', async () => {
    const { inbox, client, handlers } = setup([
      task('NOTIFY', { text: '  build เสร็จแล้ว  ' }),
      task('NOTIFY', { text: 'เงียบ', speak: false }, 't2'),
    ]);
    await expect(inbox.pollOnce()).resolves.toBe(2);
    expect(handlers.notify).toHaveBeenNthCalledWith(1, 'build เสร็จแล้ว', true);
    expect(handlers.notify).toHaveBeenNthCalledWith(2, 'เงียบ', false);
    expect(client.finishTask).toHaveBeenCalledWith('t1', true, { shown: true });
  });

  test('NOTIFY ยาวเกิน → ตัด · ว่าง → FAILED', async () => {
    const { inbox, client, handlers } = setup([
      task('NOTIFY', { text: 'ก'.repeat(MAX_NOTIFY_LENGTH + 10) }),
      task('NOTIFY', { text: '   ' }, 't2'),
    ]);
    await inbox.pollOnce();
    expect((nth(handlers.notify.mock.calls, 0)[0] as string).length).toBe(MAX_NOTIFY_LENGTH);
    expect(client.finishTask).toHaveBeenCalledWith('t2', false, { error: 'payload.text ว่าง' });
  });

  test('DEVICE_TOOL → bridge · ตัด confirmed ที่ PC ส่งมาทิ้ง', async () => {
    const { inbox, client, handlers } = setup([
      task('DEVICE_TOOL', { tool: 'device.tap', text: 'ส่ง', args: { confirmed: true } }),
      task(
        'DEVICE_TOOL',
        { tool: 'device.launch', text: 'LINE', args: { timeoutMs: 3000, confirmed: true } },
        't2',
      ),
    ]);
    await inbox.pollOnce();
    expect(handlers.deviceTool).toHaveBeenNthCalledWith(1, { tool: 'device.tap', text: 'ส่ง' });
    expect(handlers.deviceTool).toHaveBeenNthCalledWith(2, {
      tool: 'device.launch',
      text: 'LINE',
      args: { timeoutMs: 3000 },
    });
    expect(client.finishTask).toHaveBeenCalledWith('t1', true, {
      output: 'ตั้งเสียงเป็น 30% แล้ว',
    });
  });

  test('DEVICE_TOOL ที่ไม่ใช่ device.* / instruction แปลก → FAILED ไม่เรียก handler', async () => {
    const { inbox, client, handlers } = setup([
      task('DEVICE_TOOL', { tool: 'mcp.github.delete_repo' }),
      task('RUN_SHELL', {}, 't2'),
    ]);
    await inbox.pollOnce();
    expect(handlers.deviceTool).not.toHaveBeenCalled();
    expect(client.finishTask).toHaveBeenCalledWith('t1', false, {
      error: 'สั่ง tool "mcp.github.delete_repo" จาก PC ไม่ได้ (รับเฉพาะ device.*)',
    });
    expect(client.finishTask).toHaveBeenCalledWith('t2', false, {
      error: 'มือถือไม่รู้จัก instruction "RUN_SHELL"',
    });
  });

  test('handler throw → FAILED (redact) · งานถัดไปยังทำต่อ', async () => {
    const { inbox, client, handlers } = setup([
      task('NOTIFY', { text: 'a' }),
      task('NOTIFY', { text: 'b' }, 't2'),
    ]);
    handlers.notify.mockImplementationOnce(() => {
      throw new Error('พัง key sk-abcdefghijklmnopqrstuvwxyz123456');
    });
    await inbox.pollOnce();
    const failed = nth(client.finishTask.mock.calls, 0) as unknown[];
    expect(failed[1]).toBe(false);
    expect(JSON.stringify(failed[2])).not.toContain('sk-abcdefghijklmnop');
    expect(client.finishTask).toHaveBeenCalledWith('t2', true, { shown: true });
  });

  test('ดึง inbox ล้ม → log ไม่ throw · ส่งผลล้ม → งานอื่นยังทำ', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken = setup([]);
    broken.client.claimInbox.mockRejectedValueOnce(new Error('offline'));
    await expect(broken.inbox.pollOnce()).resolves.toBe(0);

    const { inbox, client, handlers } = setup([
      task('NOTIFY', { text: 'a' }),
      task('NOTIFY', { text: 'b' }, 't2'),
    ]);
    client.finishTask.mockRejectedValueOnce(new Error('offline'));
    await expect(inbox.pollOnce()).resolves.toBe(2);
    expect(handlers.notify).toHaveBeenCalledTimes(2);
  });

  test('start: ดึงทันที + ตาม interval · ไม่ดึงซ้อนรอบ · stop หยุด', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      let release: () => void = () => {};
      const { inbox, client } = setup([]);
      client.claimInbox.mockImplementation(
        () =>
          new Promise<InboxTask[]>((resolve) => {
            release = () => resolve([]);
          }),
      );
      inbox.start();
      inbox.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(client.claimInbox).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(15_000); // รอบแรกยังไม่จบ → ข้าม
      expect(client.claimInbox).toHaveBeenCalledTimes(1);
      release();
      await jest.advanceTimersByTimeAsync(15_000);
      expect(client.claimInbox).toHaveBeenCalledTimes(2);
      inbox.stop();
      expect(inbox.running).toBe(false);
      release();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(client.claimInbox).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('appInboxHandlers', () => {
  const lastMessage = () => {
    const s = useAtomStore.getState();
    return s.messagesByPersona[s.activePersona].at(-1)?.content;
  };

  test('notify: ขึ้นแชท + พูดเมื่อว่าง · ไม่พูดตอนฟังอยู่', async () => {
    const speak = jest.spyOn(voiceOrchestrator, 'speak').mockResolvedValue();
    useAtomStore.getState().setMood('idle');
    await appInboxHandlers.notify('build เสร็จแล้ว', true);
    expect(lastMessage()).toBe(`${NOTIFY_PREFIX}build เสร็จแล้ว`);
    expect(speak).toHaveBeenCalledWith('build เสร็จแล้ว', useAtomStore.getState().activePersona);

    useAtomStore.getState().setMood('listening');
    await appInboxHandlers.notify('อีกอัน', true);
    expect(speak).toHaveBeenCalledTimes(1);
    useAtomStore.getState().setMood('idle');
    await appInboxHandlers.notify('เงียบ', false);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  test('deviceTool: ปุ่มเสี่ยง → รอ "ยืนยัน" ใน store ร่วม · แจ้งในแชท', async () => {
    const asked: AgentToolResult = {
      ok: false,
      output: '⚠️ "ส่ง" อาจเป็นคำสั่งสำคัญ',
      needsConfirmation: true,
    };
    const call = jest
      .spyOn(deviceControl, 'call')
      .mockResolvedValueOnce(asked)
      .mockResolvedValueOnce({ ok: true, output: 'กด "ส่ง" แล้ว' });
    await expect(appInboxHandlers.deviceTool({ tool: 'device.tap', text: 'ส่ง' })).resolves.toBe(
      asked,
    );
    expect(lastMessage()).toBe(`Mark 55 สั่งมือถือ: ${asked.output}`);
    await expect(deviceConfirmations.confirm()).resolves.toEqual({
      ok: true,
      output: 'กด "ส่ง" แล้ว',
    });
    expect(call).toHaveBeenLastCalledWith({
      tool: 'device.tap',
      text: 'ส่ง',
      args: { confirmed: true },
    });
  });
});

test('boot เริ่ม inbox · inbox ล้มไม่ทำให้ boot ล้ม', async () => {
  const base = {
    modules: { start: async () => ({ ready: [], failed: [] }) },
    memory: { list: async () => [] } as never, // trust boundary ของ test: boot ใช้แค่ list()
    dev: false,
    installDevTools: () => undefined,
  };
  const inbox = { start: jest.fn() };
  await startServices({ ...base, inbox });
  expect(inbox.start).toHaveBeenCalledTimes(1);

  jest.spyOn(console, 'error').mockImplementation(() => {});
  const broken = {
    start: () => {
      throw new Error('x');
    },
  };
  await expect(startServices({ ...base, inbox: broken })).resolves.toMatchObject({
    memoryFacts: 0,
  });
});
