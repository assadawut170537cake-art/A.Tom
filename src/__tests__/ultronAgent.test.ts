import type { AgentLLM, AgentMessage } from '../core/agent/types';
import { AgentRegistry } from '../core/agents/AgentRegistry';
import { ProviderError } from '../core/http/errors';
import type { BusTask } from '../features/pc-bridge/MemoryBusClient';
import type { BusClient } from '../features/pc-bridge/PcBridgeModule';
import { NOT_CONFIGURED_REPLY } from '../features/pc-bridge/PcBridgeModule';
import type { PcBridgeConfig } from '../features/pc-bridge/settings';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { createDeviceAgent } from '../modules/agents/device-agent';
import { createTaskAgent } from '../modules/agents/task-agent';
import {
  createUltronAgent,
  describeDecision,
  extractCode,
  MAX_CODE_BYTES,
  parseDecision,
  ULTRON_AGENT_ID,
  ULTRON_CODE_PROMPT,
  type UltronAgentDeps,
} from '../modules/agents/ultron-agent';
import { DeviceControlBridge } from '../core/agent/DeviceControlBridge';
import { nth } from '../test-utils/nth';

const CONFIG: PcBridgeConfig = {
  url: 'https://abc.supabase.co',
  anonKey: 'k',
  token: `atm_${'a'.repeat(64)}`,
};
const TASK_ID = '1a2b3c4d-0000-4000-8000-000000000000';

const busTask = (status: BusTask['status'], result: Record<string, unknown>): BusTask => ({
  taskId: TASK_ID,
  instruction: 'ULTRON_RELEASE',
  status,
  result,
  claimedBy: 'MARK_55_PC',
});

function setup(
  overrides: Partial<UltronAgentDeps> & { reply?: string; tasks?: (BusTask | null)[] } = {},
) {
  const seen: AgentMessage[][] = [];
  const llm: AgentLLM = {
    chat: jest.fn(async (messages: AgentMessage[]) => {
      seen.push(messages);
      return overrides.reply ?? '```python\nprint("hi")\n```';
    }),
  };
  const tasks = [...(overrides.tasks ?? [])];
  const client: BusClient & { submitTask: jest.Mock; getTask: jest.Mock } = {
    submitTask: jest.fn(async () => TASK_ID),
    getTask: jest.fn(async () => tasks.shift() ?? null),
  };
  const agent = createUltronAgent({
    settings: { load: async () => CONFIG },
    createClient: () => client,
    llm,
    sleep: async () => {},
    waitMs: 3,
    pollMs: 1,
    ...overrides,
  });
  return { agent, client, llm, seen };
}

const run = (agent: ReturnType<typeof setup>['agent'], commandText: string, capabilityId: string) =>
  agent.run({ text: '', commandText, capabilityId, persona: 4 });

describe('helpers', () => {
  test('extractCode: block แรก · ไม่มี block = ทั้งข้อความ', () => {
    expect(extractCode('นี่ครับ\n```python\nprint(1)\n```\n```python\nprint(2)\n```')).toBe(
      'print(1)',
    );
    expect(extractCode('```\nx = 1\n```')).toBe('x = 1');
    expect(extractCode('  print(3)  ')).toBe('print(3)');
  });

  test('parseDecision: ปลด/ทำลาย + รหัส (ไม่มี = latest)', () => {
    expect(parseDecision('ปลด')).toEqual({ instruction: 'ULTRON_RELEASE', ref: 'latest' });
    expect(parseDecision('ทำลาย sandbox 1A2B')).toEqual({
      instruction: 'ULTRON_DESTROY',
      ref: '1a2b',
    });
    expect(parseDecision('release sandbox abcd1234')).toEqual({
      instruction: 'ULTRON_RELEASE',
      ref: 'abcd1234',
    });
  });

  test('describeDecision', () => {
    expect(
      describeDecision(
        busTask('COMPLETED', {
          status: 'RELEASED',
          sandbox_id: '1a2b3c4d',
          path: 'C:\\u\\released\\1a2b3c4d',
        }),
      ),
    ).toContain('ปลด sandbox 1a2b3c4d แล้วครับ · ผลอยู่ที่ C:\\u\\released\\1a2b3c4d');
    expect(
      describeDecision(busTask('COMPLETED', { status: 'DESTROYED', sandbox_id: '1a2b3c4d' })),
    ).toBe('ทำลาย sandbox 1a2b3c4d แล้วครับ');
    expect(
      describeDecision(
        busTask('COMPLETED', { status: 'ULTRON_ERROR', error: 'ไม่มี sandbox ที่รอให้ปลด/ทำลาย' }),
      ),
    ).toBe('อัลตรอนทำไม่ได้ครับ — ไม่มี sandbox ที่รอให้ปลด/ทำลาย');
  });
});

describe('classifier', () => {
  const registry = new AgentRegistry();
  registry.register(createUltronAgent({ settings: { load: async () => null } }));
  registry.register(createTaskAgent({ createAgent: jest.fn(), personaPrompt: () => '' }));
  registry.register(createDeviceAgent(new DeviceControlBridge()));
  const classifier = new AgentClassifier(registry);

  test.each([
    ['อัลตรอน ทำว่า สุ่มเลข 6 หลัก', 'ultron.run', 'สุ่มเลข 6 หลัก'],
    ['ให้อัลตรอนเขียนโค้ดว่า หาจำนวนเฉพาะถึง 100', 'ultron.run', 'หาจำนวนเฉพาะถึง 100'],
    ['อัลตรอน รันในแซนด์บ็อกซ์ว่า คำนวณดอกเบี้ย', 'ultron.run', 'คำนวณดอกเบี้ย'],
    ['รันในแซนด์บ็อกซ์ว่า คำนวณดอกเบี้ย', 'ultron.run', 'คำนวณดอกเบี้ย'],
    ['sandbox: print hello', 'ultron.run', 'print hello'],
    ['ปลด', 'ultron.decide', 'ปลด'],
    ['ทำลายเลย', 'ultron.decide', 'ทำลาย'],
    ['อัลตรอน ปลด sandbox 1a2b', 'ultron.decide', 'ปลด sandbox 1a2b'],
    ['destroy sandbox', 'ultron.decide', 'destroy sandbox'],
  ])('%s', (text, capabilityId, commandText) => {
    expect(classifier.check(text)?.entities).toMatchObject({
      agentId: ULTRON_AGENT_ID,
      capabilityId,
      commandText,
    });
  });

  test.each(['ปลดล็อกจอ', 'ทำลายสถิติโลก', 'อัลตรอนเก่งไหม', 'ยืนยัน'])(
    'ไม่แย่งประโยคอื่น: %s',
    (text) => {
      expect(classifier.check(text)?.entities ?? {}).not.toMatchObject({
        agentId: ULTRON_AGENT_ID,
      });
    },
  );
});

describe('run', () => {
  test('ยังไม่ตั้งค่า Mark 55 Bus → บอกให้ไปตั้ง (ไม่เรียก LLM)', async () => {
    const { agent, llm } = setup({ settings: { load: async () => null } });
    await expect(run(agent, 'x', 'ultron.run')).resolves.toEqual({ reply: NOT_CONFIGURED_REPLY });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test('LLM เขียนโค้ด → ULTRON_RUN (task + code) · ตอบรหัสสั้น', async () => {
    const { agent, client, seen } = setup();
    const res = await run(agent, 'สุ่มเลข 6 หลัก', 'ultron.run');
    expect(nth(nth(seen, 0), 0)).toEqual({ role: 'system', content: ULTRON_CODE_PROMPT });
    expect(nth(nth(seen, 0), 1)).toEqual({ role: 'user', content: 'สุ่มเลข 6 หลัก' });
    expect(client.submitTask).toHaveBeenCalledWith('ULTRON_RUN', {
      task: 'สุ่มเลข 6 หลัก',
      language: 'python',
      code: 'print("hi")',
    });
    expect(res.reply).toContain('รหัส 1a2b3c4d');
    expect(res.reply).toContain('"ปลด"');
  });

  test('โค้ดว่าง / ยาวเกิน / LLM ล้ม / ส่งไม่ได้ → ข้อความไทย ไม่ throw', async () => {
    expect(
      (await run(setup({ reply: '```python\n```' }).agent, 'x', 'ultron.run')).reply,
    ).toContain('เขียนโค้ดไม่ออก');
    const big = setup({ reply: 'x'.repeat(MAX_CODE_BYTES + 1) });
    expect((await run(big.agent, 'x', 'ultron.run')).reply).toContain('ยาวเกิน');
    expect(big.client.submitTask).not.toHaveBeenCalled();

    const broken = setup();
    (broken.llm.chat as jest.Mock).mockRejectedValueOnce(
      new Error('key sk-abcdefghijklmnopqrstuvwxyz123456 ผิด'),
    );
    const r = await run(broken.agent, 'x', 'ultron.run');
    expect(r.reply).toContain('เขียนโค้ดไม่สำเร็จ');
    expect(r.reply).not.toContain('sk-abcdefghijklmnop');

    const offline = setup();
    offline.client.submitTask.mockRejectedValueOnce(new ProviderError('pc-bridge', 'auth', 'x'));
    expect((await run(offline.agent, 'x', 'ultron.run')).reply).toContain('token เครื่อง');
  });

  test('ปลด → ULTRON_RELEASE latest · รอผล', async () => {
    const { agent, client } = setup({
      tasks: [
        busTask('IN_PROGRESS', {}),
        busTask('COMPLETED', { status: 'RELEASED', sandbox_id: '1a2b3c4d' }),
      ],
    });
    const res = await run(agent, 'ปลด', 'ultron.decide');
    expect(client.submitTask).toHaveBeenCalledWith('ULTRON_RELEASE', { sandbox_id: 'latest' });
    expect(res.reply).toContain('ปลด sandbox 1a2b3c4d แล้วครับ');
  });

  test('ทำลาย 1a2b → ULTRON_DESTROY · Mark 55 ไม่ตอบ = บอกว่าส่งแล้ว', async () => {
    const { agent, client } = setup();
    const res = await run(agent, 'ทำลาย 1a2b', 'ultron.decide');
    expect(client.submitTask).toHaveBeenCalledWith('ULTRON_DESTROY', { sandbox_id: '1a2b' });
    expect(res.reply).toContain('ยังไม่ตอบ');
  });
});
