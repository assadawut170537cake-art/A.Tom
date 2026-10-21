import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dayLabel, groupConversations } from '../features/jarvis/history';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import type { Message } from '../features/jarvis/types';
import { RootNavigator } from '../navigation/RootNavigator';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const MIN = 60_000;

const msg = (id: string, role: Message['role'], content: string, at: number): Message => ({
  id,
  persona: 1,
  role,
  content,
  createdAt: at,
});

describe('แบ่งประวัติเป็นบทสนทนา', () => {
  test('เงียบเกิน 30 นาที = หัวข้อใหม่ · ชื่อ = ข้อความแรกของบอส · ข้อความระบบล้วนไม่เป็นหัวข้อ', () => {
    const list = groupConversations([
      msg('a', 'assistant', 'สวัสดีครับ', 0),
      msg('b', 'user', 'ช่วยวางแผนเที่ยวเชียงใหม่', MIN),
      msg('c', 'assistant', 'ได้เลยครับ', 2 * MIN),
      msg('d', 'system', '⚠️ เน็ตหลุด', 60 * MIN),
      msg('e', 'user', 'ราคาทองวันนี้', 120 * MIN),
    ]);
    expect(list.map((c) => c.title)).toEqual(['ช่วยวางแผนเที่ยวเชียงใหม่', 'ราคาทองวันนี้']);
    expect(nth(list, 0).messages).toHaveLength(3);
    expect(nth(list, 0).preview).toBe('ได้เลยครับ');
  });

  test('หัวข้อกลุ่มตามวัน', () => {
    const now = new Date(2026, 9, 21, 12);
    expect(dayLabel(new Date(2026, 9, 21, 1).getTime(), now)).toBe('วันนี้');
    expect(dayLabel(new Date(2026, 9, 20, 23).getTime(), now)).toBe('เมื่อวาน');
    expect(dayLabel(new Date(2026, 9, 17).getTime(), now)).toBe('7 วันที่ผ่านมา');
    expect(dayLabel(new Date(2026, 8, 1).getTime(), now)).toBe('1/9/2569');
  });
});

describe('ปุ่มนาฬิกา → รายการบทสนทนา', () => {
  beforeAll(registerAll);
  beforeEach(async () => {
    await resetSettings();
    await setAIKeys(['gemini']);
    resetStore();
    useAtomStore.setState({ historyLoaded: true });
  });
  afterEach(() => jest.restoreAllMocks());

  async function openHistory() {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>,
    );
    await settle();
    await fireEvent.press(screen.getByLabelText('ประวัติ'));
    await settle();
  }

  test('แสดงเป็นหัวข้อ (ไม่ใช่ทีละข้อความ) · แตะแล้วเห็นทั้งบท · กรองตาม persona', async () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'สวัสดีอะตอม', persona: 1 });
    store.pushMessage({ role: 'assistant', content: 'ว่าไงลูกพี่', persona: 1 });
    store.pushMessage({ role: 'user', content: 'สวัสดีจาร์วิส', persona: 2 });
    await openHistory();

    expect(screen.getByLabelText('เปิดบทสนทนา สวัสดีอะตอม')).toBeTruthy();
    expect(screen.getByLabelText('เปิดบทสนทนา สวัสดีจาร์วิส')).toBeTruthy();
    expect(screen.queryByText('ว่าไงลูกพี่')).toBeNull(); // ข้อความในบทยังไม่โชว์ในรายการ

    await fireEvent.press(screen.getByRole('tab', { name: 'จาร์วิส' }));
    expect(screen.queryByLabelText('เปิดบทสนทนา สวัสดีอะตอม')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    await fireEvent.press(screen.getByLabelText('เปิดบทสนทนา สวัสดีอะตอม'));
    expect(screen.getByText('ว่าไงลูกพี่')).toBeTruthy();
  });

  test('ว่าง → บอกว่ายังไม่มี · "คุยต่อ" สลับ persona แล้วกลับหน้าหลัก', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ไฟรเดย์ช่วยหน่อย', persona: 3 });
    await openHistory();
    await fireEvent.press(screen.getByRole('tab', { name: 'อัลตรอน' }));
    expect(screen.getByText('ยังไม่มีบทสนทนากับอัลตรอน')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    await fireEvent.press(screen.getByLabelText('เปิดบทสนทนา ไฟรเดย์ช่วยหน่อย'));
    await fireEvent.press(screen.getByLabelText('คุยต่อกับไฟรเดย์'));
    await settle();
    expect(useAtomStore.getState().activePersona).toBe(3);
    expect(screen.getByLabelText('ประวัติ')).toBeTruthy();
  });

  test('ลบบทสนทนา = ถามยืนยันก่อน · ลบเฉพาะบทนั้น', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ข้อความเก่า', persona: 1 });
    const alert = jest.spyOn(Alert, 'alert');
    await openHistory();
    await fireEvent.press(screen.getByLabelText('เปิดบทสนทนา ข้อความเก่า'));
    await fireEvent.press(screen.getByLabelText('ลบบทสนทนานี้'));
    expect(useAtomStore.getState().messagesByPersona[1]).toHaveLength(1);
    const buttons = nth(alert.mock.calls, 0)[2] ?? [];
    await act(() => buttons.find((b) => b.style === 'destructive')?.onPress?.());
    expect(useAtomStore.getState().messagesByPersona[1]).toHaveLength(0);
  });
});
