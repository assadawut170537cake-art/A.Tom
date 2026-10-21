import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ScreenErrorBoundary } from '../core/components/ScreenErrorBoundary';
import { ProviderError } from '../core/http/errors';
import {
  ONNX_GUARD_KEY,
  __resetOnnxGuardCache,
  checkOnnxGuardOnBoot,
  isOnnxBroken,
  resetOnnxGuard,
  withOnnxGuard,
} from '../features/voice/onnxGuard';
import {
  REALTIME_FALLBACK_NOTE,
  RealtimeVoiceSession,
  describeRealtimeError,
} from '../features/voice/realtime/RealtimeVoiceSession';
import type { RealtimeTransport } from '../features/voice/realtime/types';

beforeEach(async () => {
  await AsyncStorage.removeItem(ONNX_GUARD_KEY);
  __resetOnnxGuardCache();
});

describe('onnxGuard — แอปเด้งตอนโหลดโมเดลแล้วไม่เด้งวน', () => {
  test('โหลดจบ (สำเร็จ/ error JS) = ลบเครื่องหมาย · ไม่ถือว่าพัง', async () => {
    await withOnnxGuard('t', async () => 1);
    await expect(withOnnxGuard('t', async () => Promise.reject(new Error('js')))).rejects.toThrow(
      'js',
    );
    expect(await AsyncStorage.getItem(ONNX_GUARD_KEY)).toBeNull();
    expect(await checkOnnxGuardOnBoot()).toBe(false);
  });

  test('ค้าง "กำลังโหลด" จากรอบก่อน (native crash) → เปิดแอปใหม่ = พัง → ไม่โหลดอีก จนบอสกดลองใหม่', async () => {
    await AsyncStorage.setItem(ONNX_GUARD_KEY, 'loading'); // จำลอง: แอปตายระหว่างโหลด
    __resetOnnxGuardCache(); // = เปิดแอปใหม่
    expect(await checkOnnxGuardOnBoot()).toBe(true);
    expect(await isOnnxBroken()).toBe(true);
    const load = jest.fn(async () => 1);
    await expect(withOnnxGuard('wakeword', load)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(load).not.toHaveBeenCalled();
    await resetOnnxGuard();
    expect(await withOnnxGuard('wakeword', load)).toBe(1);
  });

  test('โหลดพร้อมกัน 2 ตัว: เครื่องหมายอยู่จนตัวสุดท้ายจบ', async () => {
    let release: () => void = () => {};
    const slow = withOnnxGuard('a', () => new Promise<void>((r) => (release = r)));
    await withOnnxGuard('b', async () => undefined);
    expect(await AsyncStorage.getItem(ONNX_GUARD_KEY)).toBe('loading');
    release();
    await slow;
    expect(await AsyncStorage.getItem(ONNX_GUARD_KEY)).toBeNull();
  });
});

describe('ScreenErrorBoundary — หน้าพังแล้วไม่ปิดแอป', () => {
  test('แสดงข้อความ error จริง + ลองใหม่', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Boom() {
      if (fail) throw new Error('native module หาย');
      return <Text>หายแล้ว</Text>;
    }
    await render(
      <ScreenErrorBoundary screen="VoiceSettings">
        <Boom />
      </ScreenErrorBoundary>,
    );
    expect(screen.getByText('หน้า VoiceSettings มีปัญหา')).toBeTruthy();
    expect(screen.getByText(/native module หาย/)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByLabelText('ลองใหม่'));
    expect(screen.getByText('หายแล้ว')).toBeTruthy();
  });
});

describe('เสียงสดต่อไม่ติด → สลับทางสำรอง', () => {
  const brokenTransport = (error: unknown): RealtimeTransport =>
    ({
      connect: async () => {
        throw error;
      },
      close: () => {},
    }) as unknown as RealtimeTransport; // trust boundary ของ test: session เรียกแค่ connect/close ตอนต่อไม่ติด

  const session = (transport: RealtimeTransport, onConnectFailed?: (e: unknown) => boolean) => {
    const messages: string[] = [];
    const s = new RealtimeVoiceSession({
      transport,
      buildConfig: async () => ({}) as never,
      ensureMic: async () => {},
      ask: async () => '',
      onUserText: () => {},
      onAssistantText: () => {},
      onMessage: (m) => messages.push(m),
      ...(onConnectFailed && { onConnectFailed }),
    });
    return { s, messages };
  };

  test('error ที่ไม่ใช่ ProviderError ไม่ถูกบอกว่า "ไม่มีอินเทอร์เน็ต" — แสดงข้อความจริง', () => {
    const text = describeRealtimeError(new TypeError("Cannot read property 'start' of undefined"));
    expect(text).not.toContain('อินเทอร์เน็ต');
    expect(text).toContain("Cannot read property 'start'");
  });

  test('ต่อไม่ติด → เรียกทางสำรอง + บอกว่าสลับแล้ว · state กลับ idle', async () => {
    const fallback = jest.fn(() => true);
    const { s, messages } = session(brokenTransport(new Error('ws ปิด')), fallback);
    await s.start();
    expect(fallback).toHaveBeenCalled();
    expect(s.active).toBe(false);
    expect(messages.join('\n')).toContain(REALTIME_FALLBACK_NOTE);
  });

  test('ไมค์ไม่ได้สิทธิ์ = ไม่สลับ (ทางอื่นก็ใช้ไม่ได้)', async () => {
    const fallback = jest.fn(() => true);
    const { s } = session(
      brokenTransport(new ProviderError('voice', 'permission', 'ไม่ได้สิทธิ์ไมค์')),
      fallback,
    );
    await s.start();
    expect(fallback).not.toHaveBeenCalled();
  });
});
