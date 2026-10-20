import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { RootNavigator } from '../navigation/RootNavigator';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

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
  await fireEvent.press(screen.getByLabelText('ประวัติ')); // ปุ่มนาฬิกาซ้ายบน
  await settle();
}

describe('ปุ่มนาฬิกา → ประวัติการสนทนา', () => {
  test('เปิดหน้าประวัติได้ · แสดงข้อความของ persona ที่เลือก · สลับ persona ดูได้', async () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'สวัสดีอะตอม', persona: 1 });
    store.pushMessage({ role: 'assistant', content: 'ว่าไงลูกพี่', persona: 1 });
    store.pushMessage({ role: 'user', content: 'สวัสดีจาร์วิส', persona: 2 });
    await openHistory();

    expect(screen.getByText('สวัสดีอะตอม')).toBeTruthy();
    expect(screen.getByText('ว่าไงลูกพี่')).toBeTruthy();
    expect(screen.queryByText('สวัสดีจาร์วิส')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'จาร์วิส' }));
    expect(screen.getByText('สวัสดีจาร์วิส')).toBeTruthy();
    expect(screen.queryByText('สวัสดีอะตอม')).toBeNull();
  });

  test('ว่าง → บอกว่ายังไม่มีบทสนทนา · "คุยต่อ" สลับ persona แล้วกลับหน้าหลัก', async () => {
    await openHistory();
    await fireEvent.press(screen.getByRole('tab', { name: 'ไฟรเดย์' }));
    expect(screen.getByText('ยังไม่มีบทสนทนากับไฟรเดย์')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('คุยต่อกับไฟรเดย์'));
    await settle();
    expect(useAtomStore.getState().activePersona).toBe(3);
    expect(screen.getByLabelText('ประวัติ')).toBeTruthy(); // กลับมาหน้าหลักแล้ว
  });

  test('ล้างประวัติ = ถามยืนยันก่อน · กดล้างแล้วข้อความหาย', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ข้อความเก่า', persona: 1 });
    const alert = jest.spyOn(Alert, 'alert');
    await openHistory();

    await fireEvent.press(screen.getByLabelText('ล้างประวัติ'));
    expect(alert).toHaveBeenCalled();
    expect(useAtomStore.getState().messagesByPersona[1]).toHaveLength(1); // ยังไม่ลบจนกว่าจะยืนยัน

    const buttons = nth(alert.mock.calls, 0)[2] ?? [];
    await act(() => buttons.find((b) => b.style === 'destructive')?.onPress?.());
    expect(useAtomStore.getState().messagesByPersona[1]).toHaveLength(0);
  });
});
