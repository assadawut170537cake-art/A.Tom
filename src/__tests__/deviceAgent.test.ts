import AsyncStorage from '@react-native-async-storage/async-storage';

import { DeviceControlBridge, type DeviceDriver } from '../core/agent/DeviceControlBridge';
import { AgentRegistry } from '../core/agents/AgentRegistry';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { RuleClassifier } from '../features/router/classifiers/RuleClassifier';
import { AgentHandler } from '../features/router/handlers/AgentHandler';
import {
  createDeviceAgent,
  DEVICE_AGENT_ID,
  registerDeviceAgent,
} from '../modules/agents/device-agent';
import { createNoteAgent } from '../modules/agents/sample-agent';
import { parseThaiNumber } from '../modules/agents/thaiNumber';

type FakeDriver = Required<
  Pick<DeviceDriver, 'setVolume' | 'setBrightness' | 'setTorch' | 'setClipboard'>
> & {
  [K in 'setVolume' | 'setBrightness' | 'setTorch' | 'setClipboard']: jest.Mock;
};

function fakeDriver(): FakeDriver {
  return {
    setVolume: jest.fn(async () => {}),
    setBrightness: jest.fn(async () => {}),
    setTorch: jest.fn(async () => {}),
    setClipboard: jest.fn(async () => {}),
  };
}

async function setup(enabled = true) {
  const driver = fakeDriver();
  const bridge = new DeviceControlBridge(driver);
  await bridge.setEnabled(enabled);
  const registry = new AgentRegistry();
  // note agent ลงก่อนเหมือนใน boot — ตรวจว่าไม่แย่งกัน
  registry.register(createNoteAgent());
  registry.register(createDeviceAgent(bridge));
  return {
    driver,
    registry,
    classifier: new AgentClassifier(registry),
    handler: new AgentHandler(registry),
  };
}

async function say(text: string, enabled = true) {
  const ctx = await setup(enabled);
  const route = ctx.classifier.check(text);
  if (route?.intent !== 'agent') return { ...ctx, route, reply: undefined };
  const result = await ctx.handler.handle({ text }, route);
  return { ...ctx, route, reply: result.reply };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('device agent: matching', () => {
  test.each([
    ['ปรับเสียง 30', 'device.volume', '30'],
    ['เสียง 50%', 'device.volume', '50'],
    ['ช่วยปรับเสียงเป็น 20 เปอร์เซ็นต์ครับ', 'device.volume', '20'],
    ['volume 15', 'device.volume', '15'],
    ['ปรับความสว่าง 80', 'device.brightness', '80'],
    ['ความสว่างจอ 40%', 'device.brightness', '40'],
    ['เปิดไฟฉาย', 'device.flashlight', 'เปิด'],
    ['ปิดไฟฉายหน่อย', 'device.flashlight', 'ปิด'],
    ['flashlight on', 'device.flashlight', 'on'],
    ['turn off the torch', 'device.flashlight', 'off'],
    ['คัดลอกว่า 0812345678', 'device.clipboard', '0812345678'],
    ['copy: hello', 'device.clipboard', 'hello'],
  ])('"%s" → %s (%s)', async (text, capabilityId, commandText) => {
    const { classifier } = await setup();
    expect(classifier.check(text)).toMatchObject({
      intent: 'agent',
      entities: { agentId: DEVICE_AGENT_ID, capabilityId, commandText },
    });
  });

  test.each([
    'เสียงเพราะมาก',
    'ไฟฉายอยู่ไหน',
    'ความสว่างของดวงอาทิตย์',
    'ปรับเสียงหน่อย',
    'คัดลอกงานคนอื่นได้ไหม',
  ])('ordinary chat "%s" is not captured', async (text) => {
    const { classifier } = await setup();
    expect(classifier.check(text)).toBeNull();
  });

  test('RuleClassifier (runs first) leaves device commands alone', () => {
    const rule = new RuleClassifier();
    for (const text of ['เปิดไฟฉาย', 'ปิดไฟฉาย', 'ปรับเสียง 30', 'ปรับความสว่าง 50']) {
      expect(rule.check(text)).toBeNull();
    }
  });

  test('note agent keeps its own commands', async () => {
    const { classifier } = await setup();
    expect(classifier.check('จดบันทึกว่า เปิดไฟฉาย')).toMatchObject({
      entities: { agentId: 'note' },
    });
  });
});

describe('device agent: running', () => {
  test('volume / brightness / flashlight / clipboard reach the driver and reply in Thai', async () => {
    let r = await say('ปรับเสียง 30');
    expect(r.driver.setVolume).toHaveBeenCalledWith(0.3);
    expect(r.reply).toBe('ตั้งเสียงเป็น 30% แล้วครับ');

    r = await say('ปรับความสว่าง 80');
    expect(r.driver.setBrightness).toHaveBeenCalledWith(0.8);

    r = await say('เปิดไฟฉาย');
    expect(r.driver.setTorch).toHaveBeenCalledWith(true);
    expect(r.reply).toBe('เปิดไฟฉายแล้วครับ');

    r = await say('ปิดไฟฉาย');
    expect(r.driver.setTorch).toHaveBeenCalledWith(false);

    r = await say('คัดลอกว่า สวัสดี');
    expect(r.driver.setClipboard).toHaveBeenCalledWith('สวัสดี');
  });

  test('device control switched off → points Boss to Marketplace, driver untouched', async () => {
    const r = await say('เปิดไฟฉาย', false);
    expect(r.reply).toBe('การควบคุมอุปกรณ์ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า › Marketplace');
    expect(r.driver.setTorch).not.toHaveBeenCalled();
  });

  test('unknown capability → Thai hint, no throw', async () => {
    const agent = createDeviceAgent(new DeviceControlBridge(fakeDriver()));
    await expect(agent.run({ text: 'x', commandText: 'x', persona: 1 })).resolves.toEqual({
      reply: 'ไม่เข้าใจคำสั่งอุปกรณ์ครับ — ลองพิมพ์เช่น "ปรับเสียง 30" หรือ "เปิดไฟฉาย"',
    });
  });

  test('registerDeviceAgent() is idempotent', () => {
    const registry = new AgentRegistry();
    registerDeviceAgent(registry);
    registerDeviceAgent(registry);
    expect(registry.list().map((a) => a.id)).toEqual([DEVICE_AGENT_ID]);
  });
});

describe('Thai number words (STT may spell numbers out)', () => {
  test.each([
    ['สามสิบ', 30],
    ['ยี่สิบห้า', 25],
    ['สิบ', 10],
    ['สิบเอ็ด', 11],
    ['ห้า', 5],
    ['ศูนย์', 0],
    ['ร้อย', 100],
    ['หนึ่งร้อย', 100],
    ['เก้าสิบเก้า', 99],
    ['ครึ่ง', 50],
    ['เต็ม', 100],
    ['42', 42],
  ])('parseThaiNumber("%s") = %d', (word, value) => {
    expect(parseThaiNumber(word)).toBe(value);
  });

  test.each(['', 'หน่อย', 'สามสิบกว่า', 'abc'])('parseThaiNumber("%s") = null', (word) => {
    expect(parseThaiNumber(word)).toBeNull();
  });

  test('"ปรับเสียงสามสิบ" / "ความสว่างครึ่ง" / "เสียงยี่สิบห้าเปอร์เซ็นต์" reach the driver as numbers', async () => {
    let r = await say('ปรับเสียงสามสิบ');
    expect(r.driver.setVolume).toHaveBeenCalledWith(0.3);
    expect(r.reply).toBe('ตั้งเสียงเป็น 30% แล้วครับ');

    r = await say('ความสว่างครึ่ง');
    expect(r.driver.setBrightness).toHaveBeenCalledWith(0.5);

    r = await say('เสียงยี่สิบห้าเปอร์เซ็นต์ครับ');
    expect(r.driver.setVolume).toHaveBeenCalledWith(0.25);
  });

  test('"เสียงห้ามดัง" is still ordinary chat', async () => {
    const { classifier } = await setup();
    expect(classifier.check('เสียงห้ามดัง')).toBeNull();
  });
});
