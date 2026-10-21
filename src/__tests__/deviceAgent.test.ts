import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCESSIBILITY_OFF_REPLY,
  DeviceControlBridge,
  nativeDriverParts,
  type DeviceDriver,
} from '../core/agent/DeviceControlBridge';
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
    expect(r.reply).toBe('การควบคุมอุปกรณ์ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า › Modules › Marketplace');
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

// ---------------------------------------------------------------------------------------------
// ระดับ B — เปิดแอป · ปุ่มระบบ · กด · พิมพ์ · อ่านจอ · ยืนยันคำสั่งเสี่ยง
// ---------------------------------------------------------------------------------------------

function levelBDriver(overrides: Partial<Record<keyof DeviceDriver, jest.Mock>> = {}) {
  return {
    launchApp: jest.fn(async (name: string) => (name.toLowerCase() === 'line' ? 'LINE' : '')),
    accessibilityEnabled: jest.fn(async () => true),
    openAccessibilitySettings: jest.fn(async () => {}),
    globalAction: jest.fn(async () => true),
    tapText: jest.fn(async () => 'ok'),
    typeText: jest.fn(async () => 'ok'),
    readScreen: jest.fn(async () => 'แชท\nโทร'),
    ...overrides,
  };
}

async function setupB(overrides: Partial<Record<keyof DeviceDriver, jest.Mock>> = {}) {
  const driver = levelBDriver(overrides);
  const bridge = new DeviceControlBridge(driver);
  await bridge.setEnabled(true);
  let clock = 1_000;
  const registry = new AgentRegistry();
  registry.register(createNoteAgent());
  registry.register(createDeviceAgent(bridge, () => clock));
  const classifier = new AgentClassifier(registry);
  const handler = new AgentHandler(registry);
  const send = async (text: string) => {
    const route = classifier.check(text);
    if (route?.intent !== 'agent') return undefined;
    return (await handler.handle({ text }, route)).reply;
  };
  return { driver, classifier, send, advance: (ms: number) => (clock += ms) };
}

describe('device agent level B: matching', () => {
  test.each([
    ['เปิดแอป LINE', 'device.launch', 'LINE'],
    ['เปิดแอป YouTube แล้วกด ค้นหา', 'device.launch', 'YouTube แล้วกด ค้นหา'],
    ['open app Spotify', 'device.launch', 'Spotify'],
    ['ย้อนกลับ', 'device.nav', 'ย้อนกลับ'],
    ['กดย้อนกลับหน่อย', 'device.nav', 'ย้อนกลับ'],
    ['กลับหน้าโฮม', 'device.nav', 'โฮม'],
    ['เปิดแจ้งเตือน', 'device.nav', 'แจ้งเตือน'],
    ['ล็อกจอ', 'device.nav', 'ล็อก'],
    ['แคปหน้าจอ', 'device.nav', 'แคป'],
    ['press back', 'device.nav', 'back'],
    ['กดปุ่ม ถัดไป', 'device.tap', 'ถัดไป'],
    ['แตะ "ตกลง"', 'device.tap', 'ตกลง'],
    ['tap Next', 'device.tap', 'Next'],
    ['พิมพ์ว่า สวัสดีครับ', 'device.type', 'สวัสดีครับ'],
    ['อ่านหน้าจอให้ฟังหน่อย', 'device.read_screen', ''],
    ['เปิดสิทธิ์ควบคุมมือถือ', 'device.accessibility_settings', ''],
    ['ยืนยัน', 'device.confirm', 'ยืนยัน'],
    ['ยกเลิก', 'device.cancel', 'ยกเลิก'],
  ])('"%s" → %s', async (text, capabilityId, commandText) => {
    const { classifier } = await setupB();
    expect(classifier.check(text)).toMatchObject({
      intent: 'agent',
      entities: { agentId: DEVICE_AGENT_ID, capabilityId, commandText },
    });
  });

  test.each([
    'เปิดแอปไม่ได้',
    'กดดันมาก',
    'ยืนยันตัวตนยังไง',
    'หน้าจอแตก',
    'อ่านหน้าจอไม่ออก',
    'กดไลก์ไม่ได้',
  ])('ordinary chat "%s" is not captured', async (text) => {
    const { classifier } = await setupB();
    expect(classifier.check(text)).toBeNull();
  });

  test('RuleClassifier (runs first) leaves level-B commands alone', () => {
    const rule = new RuleClassifier();
    for (const text of [
      'เปิดแอป LINE',
      'เปิดสิทธิ์ควบคุมมือถือ',
      'ล็อกจอ',
      'เปิดแจ้งเตือน',
      'กดปุ่ม ถัดไป',
    ]) {
      expect(rule.check(text)).toBeNull();
    }
  });
});

describe('device agent level B: running', () => {
  test('"เปิดแอป LINE" launches by name · unknown app → Thai reply', async () => {
    const { driver, send } = await setupB();
    expect(await send('เปิดแอป LINE')).toBe('เปิด LINE แล้วครับ');
    expect(driver.launchApp).toHaveBeenCalledWith('LINE');
    expect(await send('เปิดแอป Foobar')).toBe('ไม่พบแอปชื่อ "Foobar" ในเครื่อง');
  });

  test('"เปิดแอป LINE แล้วกด แชท" launches then waits for the button', async () => {
    const { driver, send } = await setupB();
    expect(await send('เปิดแอป LINE แล้วกด แชท')).toBe('เปิด LINE แล้ว · กด "แชท" แล้วครับ');
    expect(driver.tapText).toHaveBeenCalledWith('แชท', 6000);
  });

  test('button not on screen after launch → says so', async () => {
    const { send } = await setupB({ tapText: jest.fn(async () => 'not_found') });
    expect(await send('เปิดแอป LINE แล้วกด แชท')).toBe('เปิด LINE แล้ว แต่ไม่พบ "แชท" บนหน้าจอ');
  });

  test('system buttons: back / home / lock', async () => {
    const { driver, send } = await setupB();
    expect(await send('ย้อนกลับ')).toBe('ย้อนกลับแล้วครับ');
    expect(driver.globalAction).toHaveBeenLastCalledWith('back');
    await send('กลับหน้าโฮม');
    expect(driver.globalAction).toHaveBeenLastCalledWith('home');
    await send('ล็อกจอ');
    expect(driver.globalAction).toHaveBeenLastCalledWith('lock');
  });

  test('accessibility not enabled → tells Boss how to enable, nothing pressed', async () => {
    const { driver, send } = await setupB({ accessibilityEnabled: jest.fn(async () => false) });
    expect(await send('ย้อนกลับ')).toBe(ACCESSIBILITY_OFF_REPLY);
    expect(driver.globalAction).not.toHaveBeenCalled();
    expect(await send('เปิดสิทธิ์ควบคุมมือถือ')).toContain('เลือก "A.T.O.M. ควบคุมเครื่อง"');
    expect(driver.openAccessibilitySettings).toHaveBeenCalled();
  });

  test('risky button waits for "ยืนยัน", then presses with confirmed', async () => {
    const { driver, send } = await setupB();
    expect(await send('กดปุ่ม ซื้อเลย')).toContain('พิมพ์ "ยืนยัน" ภายใน 1 นาที');
    expect(driver.tapText).not.toHaveBeenCalled();
    expect(await send('ยืนยัน')).toBe('กด "ซื้อเลย" แล้วครับ');
    expect(driver.tapText).toHaveBeenCalledWith('ซื้อเลย', 0);
    // ใช้ได้ครั้งเดียว
    expect(await send('ยืนยัน')).toBe('ไม่มีคำสั่งที่รอยืนยันครับ');
  });

  test('risky button after "เปิดแอป … แล้วกด" also waits for confirmation', async () => {
    const { driver, send } = await setupB();
    expect(await send('เปิดแอป LINE แล้วกด ส่ง')).toContain('พิมพ์ "ยืนยัน"');
    expect(driver.tapText).not.toHaveBeenCalled();
    await send('ยืนยัน');
    expect(driver.tapText).toHaveBeenCalledWith('ส่ง', 6000);
  });

  test('confirmation expires after 1 minute · "ยกเลิก" drops it', async () => {
    const { driver, send, advance } = await setupB();
    await send('กดปุ่ม โอนเงิน');
    advance(61_000);
    expect(await send('ยืนยัน')).toBe('ไม่มีคำสั่งที่รอยืนยันครับ');
    await send('กดปุ่ม ลบ');
    expect(await send('ยกเลิก')).toBe('ยกเลิกแล้วครับ ไม่ได้กดอะไร');
    expect(await send('ยืนยัน')).toBe('ไม่มีคำสั่งที่รอยืนยันครับ');
    expect(driver.tapText).not.toHaveBeenCalled();
  });

  test('type and read screen', async () => {
    const { driver, send } = await setupB();
    expect(await send('พิมพ์ว่า สวัสดี')).toBe('พิมพ์แล้วครับ');
    expect(driver.typeText).toHaveBeenCalledWith('สวัสดี');
    expect(await send('อ่านหน้าจอ')).toBe('บนหน้าจอมี:\nแชท\nโทรครับ');
  });

  test('no input field focused → Thai hint', async () => {
    const { send } = await setupB({ typeText: jest.fn(async () => 'no_field') });
    expect(await send('พิมพ์ว่า สวัสดี')).toBe(
      'ไม่มีช่องพิมพ์ที่เลือกอยู่ — แตะช่องพิมพ์ก่อน หรือสั่ง "กด <ชื่อช่อง>"',
    );
  });

  test('older APK (native module without level-B functions) → "ยังไม่รองรับ"', async () => {
    const parts = nativeDriverParts({ setVolume: jest.fn(), setTorch: jest.fn(() => true) });
    expect(parts.launchApp).toBeUndefined();
    const bridge = new DeviceControlBridge(parts);
    await bridge.setEnabled(true);
    await expect(bridge.call({ tool: 'device.launch', text: 'LINE' })).resolves.toEqual({
      ok: false,
      output: 'เครื่องนี้ยังไม่รองรับ "เปิดแอปตามชื่อ"',
    });
  });

  test('nativeDriverParts wires every level-B function', async () => {
    const native = {
      setVolume: jest.fn(),
      setTorch: jest.fn(() => true),
      launchApp: jest.fn(() => 'LINE'),
      isAccessibilityEnabled: jest.fn(() => true),
      openAccessibilitySettings: jest.fn(),
      globalAction: jest.fn(() => true),
      tapText: jest.fn(async () => 'ok'),
      typeText: jest.fn(() => 'ok'),
      readScreen: jest.fn(() => 'x'),
    };
    const p = nativeDriverParts(native);
    expect(await p.launchApp?.('line')).toBe('LINE');
    expect(await p.accessibilityEnabled?.()).toBe(true);
    await p.openAccessibilitySettings?.();
    expect(await p.globalAction?.('home')).toBe(true);
    expect(await p.tapText?.('a', 5)).toBe('ok');
    expect(await p.typeText?.('b')).toBe('ok');
    expect(await p.readScreen?.()).toBe('x');
    expect(native.tapText).toHaveBeenCalledWith('a', 5);
    expect(native.openAccessibilitySettings).toHaveBeenCalled();
  });
});
