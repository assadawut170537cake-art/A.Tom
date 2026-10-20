import { AgentRegistry } from '../core/agents/AgentRegistry';
import { ProviderError } from '../core/http/errors';
import type { BusTask } from '../features/pc-bridge/MemoryBusClient';
import type { BusClient } from '../features/pc-bridge/PcBridgeModule';
import { NOT_CONFIGURED_REPLY } from '../features/pc-bridge/PcBridgeModule';
import type { PcBridgeConfig } from '../features/pc-bridge/settings';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { createDeviceAgent } from '../modules/agents/device-agent';
import {
  createReaAgent,
  describeReaResult,
  REA_AGENT_ID,
  type ReaAgentDeps,
} from '../modules/agents/rea-agent';
import { DeviceControlBridge } from '../core/agent/DeviceControlBridge';

const CONFIG: PcBridgeConfig = {
  url: 'https://abc.supabase.co',
  anonKey: 'k',
  token: `atm_${'a'.repeat(64)}`,
};
const TASK_ID = '1a2b3c4d-0000-4000-8000-000000000000';

const busTask = (status: BusTask['status'], result: Record<string, unknown>): BusTask => ({
  taskId: TASK_ID,
  instruction: 'REVERSE_ENGINEER',
  status,
  result,
  claimedBy: 'MARK_55_PC',
});

function setup(overrides: Partial<ReaAgentDeps> & { tasks?: (BusTask | null)[] } = {}) {
  const tasks = [...(overrides.tasks ?? [])];
  const client: BusClient & { submitTask: jest.Mock; getTask: jest.Mock } = {
    submitTask: jest.fn(async () => TASK_ID),
    getTask: jest.fn(async () => tasks.shift() ?? null),
  };
  const agent = createReaAgent({
    settings: { load: async () => CONFIG },
    createClient: () => client,
    sleep: async () => {},
    waitMs: 3,
    pollMs: 1,
    ...overrides,
  });
  return { agent, client };
}

const run = (agent: ReturnType<typeof setup>['agent'], commandText: string) =>
  agent.run({ text: '', commandText, capabilityId: 'rea.doors', persona: 1 });

describe('describeReaResult', () => {
  test('OK + doors → สรุปทางเข้า', () => {
    const reply = describeReaResult(
      busTask('COMPLETED', {
        status: 'OK',
        package: 'com.example.app',
        doors: [
          { kind: 'activity', name: '.ChatActivity', open: 'exampleapp://chat/room' },
          { kind: 'service', name: '.SyncService', open: 'am start -n com.example.app/.SyncService' },
        ],
      }),
    );
    expect(reply).toContain('com.example.app');
    expect(reply).toContain('เจอ 2 ทางเข้า');
    expect(reply).toContain('exampleapp://chat/room');
  });

  test('OK แต่ไม่มี door → บอกว่าไม่เจอทางเข้า', () => {
    expect(describeReaResult(busTask('COMPLETED', { status: 'OK', package: 'com.x', doors: [] }))).toContain(
      'ไม่เจอทางเข้า',
    );
  });

  test('FAILED / RE_ERROR → ข้อความไทย', () => {
    expect(describeReaResult(busTask('FAILED', { error: 'ไม่พบไฟล์ APK' }))).toContain('ไม่พบไฟล์ APK');
    expect(describeReaResult(busTask('COMPLETED', { status: 'RE_ERROR', error: 'timeout' }))).toContain(
      'แกะแอปไม่สำเร็จ',
    );
  });
});

describe('classifier', () => {
  const registry = new AgentRegistry();
  registry.register(createReaAgent({ settings: { load: async () => null } }));
  registry.register(createDeviceAgent(new DeviceControlBridge()));
  const classifier = new AgentClassifier(registry);

  test.each([
    ['แกะแอป com.example.app', 'com.example.app'],
    ['วิเคราะห์แอป LINE', 'LINE'],
    ['หาทางเข้าแอป ธนาคาร', 'ธนาคาร'],
    ['แอป LINE มี deep link อะไรบ้าง', 'LINE'],
  ])('%s → แกะแอป', (text, commandText) => {
    expect(classifier.check(text)?.entities).toMatchObject({
      agentId: REA_AGENT_ID,
      capabilityId: 'rea.doors',
      commandText,
    });
  });

  test.each(['เปิดแอป LINE', 'แอปนี้ดีไหม', 'แกะกล่องพัสดุ'])('ไม่แย่งประโยคอื่น: %s', (text) => {
    expect(classifier.check(text)?.entities ?? {}).not.toMatchObject({ agentId: REA_AGENT_ID });
  });
});

describe('run', () => {
  test('ยังไม่ตั้งค่า Mark 55 → บอกให้ไปตั้ง', async () => {
    const { agent } = setup({ settings: { load: async () => null } });
    await expect(run(agent, 'com.x')).resolves.toEqual({ reply: NOT_CONFIGURED_REPLY });
  });

  test('ส่ง REVERSE_ENGINEER + รอผล → สรุปทางเข้า', async () => {
    const { agent, client } = setup({
      tasks: [
        busTask('IN_PROGRESS', {}),
        busTask('COMPLETED', { status: 'OK', package: 'com.x', doors: [{ kind: 'activity', name: '.A' }] }),
      ],
    });
    const res = await run(agent, 'com.x');
    expect(client.submitTask).toHaveBeenCalledWith('REVERSE_ENGINEER', { target: 'com.x' });
    expect(res.reply).toContain('เจอ 1 ทางเข้า');
  });

  test('Mark 55 ไม่ตอบ → บอกว่าส่งแล้ว', async () => {
    const { agent } = setup();
    expect((await run(agent, 'com.x')).reply).toContain('ยังแกะไม่เสร็จ');
  });

  test('ส่งไม่ได้ → ข้อความไทย ไม่ throw', async () => {
    const offline = setup();
    offline.client.submitTask.mockRejectedValueOnce(new ProviderError('pc-bridge', 'auth', 'x'));
    expect((await run(offline.agent, 'com.x')).reply).toContain('token เครื่อง');
  });

  test('ไม่บอกเป้าหมาย → ขอชื่อแอป', async () => {
    const { agent, client } = setup();
    expect((await run(agent, '   ')).reply).toContain('บอกชื่อแอป');
    expect(client.submitTask).not.toHaveBeenCalled();
  });
});
