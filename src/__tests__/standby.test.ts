import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { AgentRegistry } from '../core/agents/AgentRegistry';
import {
  needsWakeWord,
  STANDBY_OFF_MESSAGE,
  useLiveVoice,
} from '../features/jarvis/hooks/useLiveVoice';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import {
  IDLE_TIMEOUT_MS,
  LiveVoiceSession,
  SILENCE_END_MS,
  type LiveRespondHooks,
  type LiveVoiceDeps,
} from '../features/voice/live/LiveVoiceSession';
import {
  resetStandbyStore,
  STANDBY_STORAGE_KEY,
  useStandbyStore,
} from '../features/voice/live/standbyStore';
import { stripWakeWord } from '../features/voice/live/wakeWord';
import {
  createStandbyAgent,
  STANDBY_AGENT_ID,
  STANDBY_OFF_REPLY,
  STANDBY_ON_REPLY,
} from '../modules/agents/standby-agent';

const LOUD = -20;
const QUIET = -160;

describe('stripWakeWord', () => {
  test.each([
    ['อัลตรอน ปรับเสียง 30', 'ปรับเสียง 30'],
    ['อะตอม, เปิดไฟฉาย', 'เปิดไฟฉาย'],
    ['เฮ้ จาร์วิส อ่านหน้าจอ', 'อ่านหน้าจอ'],
    ['จาวิสครับ กดปุ่ม ถัดไป', 'กดปุ่ม ถัดไป'],
    ['Hey Friday, read screen', 'read screen'],
    ['ฟรายเดย์', ''],
    ['  "อัลตรอน" ย้อนกลับ', 'ย้อนกลับ'],
  ])('%s → %s', (text, rest) => {
    expect(stripWakeWord(text)).toBe(rest);
  });

  test.each(['ปรับเสียง 30', 'วันนี้อะตอมไปไหน', 'ข่าวภาคค่ำ'])('ไม่ได้เรียกชื่อ: %s', (text) => {
    expect(stripWakeWord(text)).toBeNull();
  });
});

test('needsWakeWord: เฉพาะโหมดเฝ้าตอนแอปไม่อยู่หน้าสุด', () => {
  expect(needsWakeWord(true, 'background')).toBe(true);
  expect(needsWakeWord(true, 'inactive')).toBe(true);
  expect(needsWakeWord(true, 'active')).toBe(false);
  expect(needsWakeWord(false, 'background')).toBe(false);
});

describe('LiveVoiceSession — โหมดเฝ้า', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  function setup(overrides: Partial<LiveVoiceDeps> = {}) {
    const meter = { level: QUIET };
    const fx = {
      meter,
      messages: [] as string[],
      transcribe: jest.fn(async (_uri: string) => 'อัลตรอน ปรับเสียง 30'),
      respond: jest.fn(async (_text: string, hooks: LiveRespondHooks) => void hooks.onSpeaking()),
    };
    const session = new LiveVoiceSession({
      recorder: {
        start: jest.fn(async () => {}),
        level: () => meter.level,
        stop: jest.fn(async () => 'file:///cache/rec.m4a'),
      },
      ensureMic: async () => {},
      transcribe: fx.transcribe,
      respond: fx.respond,
      stopSpeech: jest.fn(),
      onMessage: (m) => fx.messages.push(m),
      ...overrides,
    });
    const say = async (ms = 800) => {
      meter.level = LOUD;
      await jest.advanceTimersByTimeAsync(ms);
      meter.level = QUIET;
      await jest.advanceTimersByTimeAsync(SILENCE_END_MS + 100);
    };
    return { session, fx, say };
  }

  test('keepAlive → ไม่ออกเองเมื่อเงียบเกิน IDLE_TIMEOUT_MS', async () => {
    const { session, fx } = setup({ keepAlive: () => true });
    await session.start();
    await jest.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS * 4);
    expect(session.getState()).toBe('listening');
    expect(fx.messages).toEqual([]);
    session.stop();
  });

  test('ปิด keepAlive กลางทาง → กลับมานับ idle ตามปกติ', async () => {
    let keep = true;
    const { session } = setup({ keepAlive: () => keep });
    await session.start();
    await jest.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1000);
    keep = false;
    await jest.advanceTimersByTimeAsync(200);
    expect(session.getState()).toBe('idle');
  });

  test('ต้องเรียกชื่อ → ส่งเฉพาะคำสั่งหลังชื่อ · ประโยคอื่นทิ้งเงียบ ๆ', async () => {
    const { session, fx, say } = setup({ requireWakeWord: () => true });
    await session.start();
    await say();
    expect(fx.respond).toHaveBeenCalledWith('ปรับเสียง 30', expect.anything());

    fx.transcribe.mockResolvedValueOnce('ข่าวภาคค่ำวันนี้').mockResolvedValueOnce('อัลตรอน');
    await say();
    await say();
    expect(fx.respond).toHaveBeenCalledTimes(1);
    expect(session.getState()).toBe('listening');
    expect(fx.messages).toEqual([]);
    session.stop();
  });

  test('ไม่ต้องเรียกชื่อ (แอปหน้าสุด) → ส่งทั้งประโยคตามเดิม', async () => {
    const { session, fx, say } = setup({ requireWakeWord: () => false });
    await session.start();
    await say();
    expect(fx.respond).toHaveBeenCalledWith('อัลตรอน ปรับเสียง 30', expect.anything());
    session.stop();
  });
});

describe('standbyStore', () => {
  beforeEach(async () => {
    resetStandbyStore();
    await AsyncStorage.clear();
  });

  test('จำค่าใน AsyncStorage · โหลดกลับมาได้', async () => {
    await useStandbyStore.getState().setEnabled(true);
    expect(await AsyncStorage.getItem(STANDBY_STORAGE_KEY)).toBe('true');
    resetStandbyStore();
    await useStandbyStore.getState().load();
    expect(useStandbyStore.getState()).toMatchObject({ enabled: true, loaded: true });
  });

  test('ไม่มีค่า / ค่าเสีย → ปิด', async () => {
    await AsyncStorage.setItem(STANDBY_STORAGE_KEY, '"yes"');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await useStandbyStore.getState().load();
    expect(useStandbyStore.getState()).toMatchObject({ enabled: false, loaded: true });
  });

  test('สั่งก่อนโหลดเสร็จ → ค่าที่สั่งชนะ', async () => {
    await AsyncStorage.setItem(STANDBY_STORAGE_KEY, 'false');
    const loading = useStandbyStore.getState().load();
    await useStandbyStore.getState().setEnabled(true);
    await loading;
    expect(useStandbyStore.getState().enabled).toBe(true);
  });
});

describe('agent โหมดเฝ้า', () => {
  const setEnabled = jest.fn(async (_on: boolean) => {});
  const registry = new AgentRegistry();
  registry.register(createStandbyAgent(() => ({ setEnabled })));
  const classifier = new AgentClassifier(registry);

  test.each([
    ['เปิดโหมดเฝ้า', 'เปิด'],
    ['ปิดโหมดเฝ้าหน่อย', 'ปิด'],
    ['เปิดโหมดฟังตลอด', 'เปิด'],
    ['ช่วยเปิดฟังเบื้องหลังครับ', 'เปิด'],
    ['ฟังตลอด', 'ฟังตลอด'],
    ['เฝ้าไว้เลย', 'เฝ้า'],
    ['หยุดเฝ้า', 'หยุด'],
  ])('%s', (text, commandText) => {
    expect(classifier.check(text)?.entities).toMatchObject({
      agentId: STANDBY_AGENT_ID,
      commandText,
    });
  });

  test.each(['เปิดโหมดอัลตรอน', 'ช่วยเฝ้าบ้านให้หน่อยได้ไหม', 'ฟังตลอดเลยเหรอ'])(
    'ไม่แย่งประโยคอื่น: %s',
    (text) => {
      expect(classifier.check(text)).toBeNull();
    },
  );

  test.each([
    ['เปิด', true, STANDBY_ON_REPLY],
    ['ฟังตลอด', true, STANDBY_ON_REPLY],
    ['ปิด', false, STANDBY_OFF_REPLY],
    ['หยุด', false, STANDBY_OFF_REPLY],
  ])('run(%s)', async (commandText, on, reply) => {
    const agent = createStandbyAgent(() => ({ setEnabled }));
    await expect(agent.run({ text: '', commandText, persona: 4 })).resolves.toEqual({ reply });
    expect(setEnabled).toHaveBeenLastCalledWith(on);
  });
});

describe('useLiveVoice + โหมดเฝ้า', () => {
  beforeEach(async () => {
    resetStandbyStore();
    await AsyncStorage.clear();
    jest.spyOn(voiceOrchestrator, 'requestMicrophone').mockResolvedValue();
    jest.spyOn(voiceOrchestrator, 'stop').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('บันทึกไว้ว่าเปิด → เปิดหน้าหลักแล้วฟังเอง', async () => {
    await AsyncStorage.setItem(STANDBY_STORAGE_KEY, 'true');
    const { result, unmount } = await renderHook(() => useLiveVoice());
    await act(async () => {
      await useStandbyStore.getState().load();
    });
    expect(result.current).toMatchObject({ standby: true, active: true });
    await unmount();
    // สลับแท็บ (unmount) ไม่ปิดโหมดเฝ้า
    expect(useStandbyStore.getState().enabled).toBe(true);
  });

  test('สั่งเปิด → ฟัง · สั่งปิด → หยุด + แจ้งในแชท', async () => {
    const { result, unmount } = await renderHook(() => useLiveVoice());
    await act(async () => {
      await useStandbyStore.getState().load();
    });
    expect(result.current.active).toBe(false);

    await act(async () => {
      await useStandbyStore.getState().setEnabled(true);
    });
    expect(result.current).toMatchObject({ standby: true, active: true });

    await act(async () => {
      await useStandbyStore.getState().setEnabled(false);
    });
    expect(result.current).toMatchObject({ standby: false, active: false });
    const messages =
      useAtomStore.getState().messagesByPersona[useAtomStore.getState().activePersona];
    expect(messages.at(-1)?.content).toBe(STANDBY_OFF_MESSAGE);
    await unmount();
  });

  test('แตะหยุดระหว่างเฝ้า → ปิดโหมดเฝ้าตาม (ไม่ค้างว่าเปิดแต่ไม่ฟัง)', async () => {
    const { result, unmount } = await renderHook(() => useLiveVoice());
    await act(async () => {
      await useStandbyStore.getState().setEnabled(true);
    });
    expect(result.current.active).toBe(true);
    await act(async () => result.current.stop());
    expect(useStandbyStore.getState().enabled).toBe(false);
    expect(result.current.active).toBe(false);
    await unmount();
  });
});
