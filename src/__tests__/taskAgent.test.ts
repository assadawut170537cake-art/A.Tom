import { AgentHarness } from '../core/agent/AgentHarness';
import { DeviceControlBridge, type DeviceDriver } from '../core/agent/DeviceControlBridge';
import type { AgentLLM, AgentMessage } from '../core/agent/types';
import { AgentRegistry } from '../core/agents/AgentRegistry';
import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import { ModuleRegistry } from '../core/modules/ModuleRegistry';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { CONFIRM_WINDOW_MS, createConfirmationStore } from '../modules/agents/confirmations';
import { createDeviceAgent, DEVICE_AGENT_ID } from '../modules/agents/device-agent';
import {
  createTaskAgent,
  TASK_AGENT_ID,
  TASK_GUIDE,
  type TaskAgentDeps,
} from '../modules/agents/task-agent';
import { nth } from '../test-utils/nth';

/** LLM ที่ตอบตามสคริปต์ทีละ step */
function scriptedLLM(...replies: string[]): AgentLLM & { seen: AgentMessage[][] } {
  const seen: AgentMessage[][] = [];
  let i = 0;
  return {
    seen,
    chat: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      return replies[Math.min(i++, replies.length - 1)] ?? '';
    },
  };
}

type FakeDriver = Record<keyof DeviceDriver, jest.Mock>;

function fakeDriver(): FakeDriver {
  return {
    setVolume: jest.fn(async () => {}),
    setTorch: jest.fn(async () => {}),
    setBrightness: jest.fn(async () => {}),
    setClipboard: jest.fn(async () => {}),
    openWifiSettings: jest.fn(async () => {}),
    openSettings: jest.fn(async () => {}),
    canOpenUrl: jest.fn(async () => true),
    openUrl: jest.fn(async () => {}),
    launchApp: jest.fn(async () => 'LINE'),
    accessibilityEnabled: jest.fn(async () => true),
    openAccessibilitySettings: jest.fn(async () => {}),
    globalAction: jest.fn(async () => true),
    tapText: jest.fn(async () => 'ok'),
    typeText: jest.fn(async () => 'ok'),
    readScreen: jest.fn(async () => 'แชท\nโทร'),
  };
}

async function setup(llm: AgentLLM) {
  const driver = fakeDriver();
  const device = new DeviceControlBridge(driver);
  await device.setEnabled(true);
  const modules = new ModuleRegistry({
    memory: new LocalMemoryAdapter(),
    logger: { info: jest.fn(), error: jest.fn() },
  });
  const harness = new AgentHarness(llm, modules, { providers: [device], maxSteps: 8 });
  return { driver, device, harness };
}

const personaPrompt = () => 'คุณคืออะตอม';

describe('AgentHarness — ปุ่มเสี่ยง', () => {
  test('tool ขอยืนยัน → หยุดทันที ไม่ถาม LLM ต่อ · คืน pending', async () => {
    const llm = scriptedLLM(
      '{"tool":"device.launch","text":"LINE"}',
      '{"tool":"device.tap","args":{"text":"ส่ง"}}',
      '{"final":"ส่งแล้วครับ"}',
    );
    const { driver, harness } = await setup(llm);
    const result = await harness.run({ text: 'เปิด LINE แล้วกดส่ง' });

    expect(result.stopReason).toBe('needs_confirmation');
    expect(result.reply).toContain('พิมพ์ "ยืนยัน"');
    expect(result.pending).toEqual({
      tool: 'device.tap',
      text: 'เปิด LINE แล้วกดส่ง',
      args: { text: 'ส่ง' },
    });
    expect(llm.seen).toHaveLength(2);
    expect(driver.tapText).not.toHaveBeenCalled();
  });

  test('LLM ใส่ args.confirmed เองไม่มีผล (ถูกตัดทิ้ง) — กันกดปุ่มเสี่ยงโดยบอสไม่รู้', async () => {
    const llm = scriptedLLM('{"tool":"device.tap","args":{"text":"โอนเงิน","confirmed":true}}');
    const { driver, harness } = await setup(llm);
    const result = await harness.run({ text: 'โอนเงิน' });

    expect(result.stopReason).toBe('needs_confirmation');
    expect(nth(result.steps, 0).toolCall?.args).toEqual({ text: 'โอนเงิน' });
    expect(driver.tapText).not.toHaveBeenCalled();
  });

  test('args ที่เหลือแค่ confirmed → ไม่ส่ง args เลย', async () => {
    const llm = scriptedLLM(
      '{"tool":"device.read_screen","args":{"confirmed":true}}',
      '{"final":"ok"}',
    );
    const { harness } = await setup(llm);
    const result = await harness.run({ text: 'อ่านจอ' });
    expect(nth(result.steps, 0).toolCall).toEqual({ tool: 'device.read_screen', text: 'อ่านจอ' });
  });

  test('dispatch ตรง (ผู้ใช้ยืนยันแล้ว) ยังส่ง confirmed ได้', async () => {
    const { driver, harness } = await setup(scriptedLLM(''));
    const r = await harness.dispatch({
      tool: 'device.tap',
      text: 'ส่ง',
      args: { confirmed: true },
    });
    expect(r).toEqual({ ok: true, output: 'กด "ส่ง" แล้ว' });
    expect(driver.tapText).toHaveBeenCalledWith('ส่ง', 0);
  });
});

describe('ConfirmationStore', () => {
  test('ใช้ได้ครั้งเดียว · หมดอายุตาม CONFIRM_WINDOW_MS · ตัวใหม่ทับตัวเก่า', async () => {
    let t = 0;
    const store = createConfirmationStore(() => t);
    const execute = jest.fn(async () => ({ ok: true, output: 'ok' }));

    expect(await store.confirm()).toBeNull();
    store.hold({ tool: 'a', text: '' }, execute);
    store.hold({ tool: 'b', text: '', args: { x: 1 } }, execute);
    expect(await store.confirm()).toEqual({ ok: true, output: 'ok' });
    expect(execute).toHaveBeenCalledWith({ tool: 'b', text: '', args: { x: 1, confirmed: true } });
    expect(await store.confirm()).toBeNull();

    store.hold({ tool: 'c', text: '' }, execute);
    t += CONFIRM_WINDOW_MS + 1;
    expect(store.cancel()).toBe(false);
  });
});

describe('agent งาน — classifier', () => {
  const registry = new AgentRegistry();
  const createAgent = jest.fn();
  registry.register(createTaskAgent({ createAgent, personaPrompt }));
  registry.register(createDeviceAgent(new DeviceControlBridge(fakeDriver())));
  const classifier = new AgentClassifier(registry);

  test.each([
    [
      'จัดการว่า เปิด LINE ส่งข้อความหาแม่ว่าถึงบ้านแล้ว',
      TASK_AGENT_ID,
      'เปิด LINE ส่งข้อความหาแม่ว่าถึงบ้านแล้ว',
    ],
    ['ช่วยจัดการให้หน่อยว่า อ่านแจ้งเตือนล่าสุด', TASK_AGENT_ID, 'อ่านแจ้งเตือนล่าสุด'],
    ['ฝากงาน: เปิด YouTube หาเพลงสุนทราภรณ์', TASK_AGENT_ID, 'เปิด YouTube หาเพลงสุนทราภรณ์'],
    ['task: open line', TASK_AGENT_ID, 'open line'],
    ['เปิดแอป LINE แล้วพิมพ์ว่า สวัสดี', TASK_AGENT_ID, 'เปิดแอป LINE แล้วพิมพ์ว่า สวัสดี'],
    [
      'เปิดแอป LINE แล้วกด แชท แล้วพิมพ์ว่า สวัสดี',
      TASK_AGENT_ID,
      'เปิดแอป LINE แล้วกด แชท แล้วพิมพ์ว่า สวัสดี',
    ],
    // ขั้นเดียว / เปิดแล้วกด = agent อุปกรณ์ (regex ล้วน ไม่ใช้ LLM)
    ['เปิดแอป LINE', DEVICE_AGENT_ID, 'LINE'],
    ['เปิดแอป YouTube แล้วกด ค้นหา', DEVICE_AGENT_ID, 'YouTube แล้วกด ค้นหา'],
    ['ยืนยัน', DEVICE_AGENT_ID, 'ยืนยัน'],
  ])('%s → %s', (text, agentId, commandText) => {
    expect(classifier.check(text)?.entities).toMatchObject({ agentId, commandText });
  });

  test.each(['จัดการชีวิตยังไงดี', 'ช่วยจัดการเรื่องเงินหน่อย', 'ฝากงานไว้ก่อนนะ'])(
    'ประโยคคุยไม่ถูกแย่ง: %s',
    (text) => {
      expect(classifier.check(text)).toBeNull();
    },
  );
});

describe('agent งาน — run', () => {
  function taskAgent(llm: AgentLLM, deps: Partial<TaskAgentDeps> = {}) {
    const ctx = setup(llm);
    const confirmations = createConfirmationStore();
    const agent = createTaskAgent({
      createAgent: async () => (await ctx).harness,
      confirmations,
      personaPrompt,
      ...deps,
    });
    return { agent, confirmations, ctx };
  }

  test('ส่งเนื้องาน + persona prompt + คู่มือ ให้ harness · ทำหลายขั้นต่อกัน', async () => {
    const llm = scriptedLLM(
      '{"tool":"device.launch","text":"LINE"}',
      '{"tool":"device.tap","args":{"text":"แชท"}}',
      '{"tool":"device.type","args":{"text":"สวัสดี"}}',
      '{"final":"เปิด LINE แล้วพิมพ์สวัสดีให้แล้วครับบอส"}',
    );
    const { agent, ctx } = taskAgent(llm);
    const result = await agent.run({
      text: 'จัดการว่า …',
      commandText: 'เปิด LINE พิมพ์สวัสดี',
      persona: 1,
    });
    const { driver } = await ctx;

    expect(result).toEqual({ reply: 'เปิด LINE แล้วพิมพ์สวัสดีให้แล้วครับบอส' });
    const system = nth(nth(llm.seen, 0), 0).content;
    expect(system.startsWith(`คุณคืออะตอม\n\n${TASK_GUIDE}`)).toBe(true);
    expect(system).toContain('device.launch');
    expect(nth(nth(llm.seen, 0), 1)).toEqual({ role: 'user', content: 'เปิด LINE พิมพ์สวัสดี' });
    expect(driver.launchApp).toHaveBeenCalledWith('LINE');
    expect(driver.tapText).toHaveBeenCalledWith('แชท', 0);
    expect(driver.typeText).toHaveBeenCalledWith('สวัสดี');
  });

  test('ปุ่มเสี่ยง → ถามบอส · "ยืนยัน" ผ่าน agent อุปกรณ์ (store ร่วม) → กดจริง', async () => {
    const llm = scriptedLLM('{"tool":"device.tap","args":{"text":"ส่ง"}}');
    const { agent, confirmations, ctx } = taskAgent(llm);
    const asked = await agent.run({ text: '', commandText: 'กดส่ง', persona: 1 });
    const { driver, device } = await ctx;

    expect(asked.reply).toContain('พิมพ์ "ยืนยัน"');
    expect(driver.tapText).not.toHaveBeenCalled();

    const deviceAgent = createDeviceAgent(device, Date.now, confirmations);
    const done = await deviceAgent.run({
      text: 'ยืนยัน',
      commandText: 'ยืนยัน',
      capabilityId: 'device.confirm',
      persona: 1,
    });
    expect(done.reply).toBe('กด "ส่ง" แล้วครับ');
    expect(driver.tapText).toHaveBeenCalledWith('ส่ง', 0);
  });

  test('"ยกเลิก" ทิ้งคำสั่งที่ agent งานรอไว้', async () => {
    const llm = scriptedLLM('{"tool":"device.tap","args":{"text":"ลบ"}}');
    const { agent, confirmations, ctx } = taskAgent(llm);
    await agent.run({ text: '', commandText: 'ลบแชท', persona: 1 });
    const { driver, device } = await ctx;

    const deviceAgent = createDeviceAgent(device, Date.now, confirmations);
    const cancel = {
      text: 'ยกเลิก',
      commandText: 'ยกเลิก',
      capabilityId: 'device.cancel',
      persona: 1,
    } as const;
    expect((await deviceAgent.run(cancel)).reply).toBe('ยกเลิกแล้วครับ ไม่ได้กดอะไร');
    expect(
      (
        await deviceAgent.run({
          ...cancel,
          text: 'ยืนยัน',
          commandText: 'ยืนยัน',
          capabilityId: 'device.confirm',
        })
      ).reply,
    ).toBe('ไม่มีคำสั่งที่รอยืนยันครับ');
    expect(driver.tapText).not.toHaveBeenCalled();
  });

  test('LLM ล้ม → throw ต่อ (AgentHandler แปลงเป็นข้อความไทย)', async () => {
    const llm: AgentLLM = {
      chat: async () => Promise.reject(new Error('API Key ของ Gemini ไม่ถูกต้อง')),
    };
    const { agent } = taskAgent(llm);
    await expect(agent.run({ text: '', commandText: 'อะไรก็ได้', persona: 1 })).rejects.toThrow(
      'API Key',
    );
  });
});
