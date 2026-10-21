import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { useTabsStore } from '../features/jarvis/stores/useTabsStore';
import { NOTIFY_PREFIX } from '../features/pc-bridge/PcInbox';
import { thaiDate } from '../features/today/screens/TodayScreen';
import { findTask, TODAY_TASKS_KEY, useTodayStore } from '../features/today/todayStore';
import { createTodayAgent } from '../modules/agents/today-agent';
import { AgentRegistry } from '../core/agents/AgentRegistry';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { RootNavigator } from '../navigation/RootNavigator';
import { GEMINI, geminiText, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function renderApp() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RootNavigator />
    </SafeAreaProvider>,
  );
  await settle();
}

beforeAll(registerAll);
beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini']);
  resetStore();
  useAtomStore.setState({ historyLoaded: true });
  await AsyncStorage.removeItem(TODAY_TASKS_KEY);
  useTodayStore.setState({ tasks: [], loaded: false });
  useTabsStore.setState({ activeTab: 'atom' });
});
afterEach(() => jest.restoreAllMocks());

describe('เช็กลิสต์วันนี้', () => {
  test('เพิ่ม/ติ๊ก/ล้าง · บันทึกลงเครื่อง · โหลดกลับไม่ทับงานที่เพิ่มก่อนโหลดเสร็จ', async () => {
    await AsyncStorage.setItem(
      TODAY_TASKS_KEY,
      JSON.stringify([{ id: 'old', text: 'งานเก่า', done: false, createdAt: 1 }, { bad: 1 }]),
    );
    const added = useTodayStore.getState().add('  ซื้อของ  ');
    await useTodayStore.getState().load();
    expect(useTodayStore.getState().tasks.map((t) => t.text)).toEqual(['งานเก่า', 'ซื้อของ']);
    useTodayStore.getState().toggle(added?.id ?? '');
    useTodayStore.getState().clearDone();
    expect(useTodayStore.getState().tasks.map((t) => t.text)).toEqual(['งานเก่า']);
    await settle();
    expect(await AsyncStorage.getItem(TODAY_TASKS_KEY)).toContain('งานเก่า');
  });

  test('หางานจากคำพูด: ตรงทั้งคำก่อน แล้วค่อยมีคำนั้นอยู่', () => {
    const tasks = [
      { id: '1', text: 'ซื้อของเข้าบ้าน', done: false, createdAt: 0 },
      { id: '2', text: 'ซื้อของ', done: false, createdAt: 0 },
    ];
    expect(findTask(tasks, 'ซื้อของ')?.id).toBe('2');
    expect(findTask(tasks, 'เข้าบ้าน')?.id).toBe('1');
    expect(findTask(tasks, 'ไม่มี')).toBeUndefined();
  });

  test('สั่งด้วยแชท: "เพิ่มงาน …" · "ติ๊กงาน …" · "งานวันนี้มีอะไร"', async () => {
    const registry = new AgentRegistry();
    const agent = createTodayAgent();
    registry.register(agent);
    const classifier = new AgentClassifier(registry);
    const run = async (text: string) => {
      const route = classifier.check(text);
      if (route?.intent !== 'agent') throw new Error(`ไม่ match: ${text}`);
      return (
        await agent.run({
          text,
          persona: 1,
          commandText: route.entities.commandText,
          capabilityId: route.entities.capabilityId,
        })
      ).reply;
    };
    expect(await run('เพิ่มงาน ซื้อของเข้าบ้าน ครับ')).toContain('ซื้อของเข้าบ้าน');
    expect(await run('งานวันนี้มีอะไรบ้าง')).toContain('1 งาน');
    expect(await run('ติ๊กงาน ซื้อของ')).toContain('เสร็จแล้ว');
    expect(await run('งานวันนี้มีอะไร')).toBe('วันนี้ไม่มีงานค้างครับ');
    expect(classifier.check('วันนี้อากาศดีนะ')).toBeNull(); // ไม่แย่งประโยคคุย
  });

  test('วันที่ไทย พ.ศ. (ไม่พึ่ง Intl)', () => {
    expect(thaiDate(new Date(2026, 9, 20))).toBe('วันอังคารที่ 20 ตุลาคม 2569');
  });

  test('แท็บ Today: เพิ่มงานจากช่อง · นับข้อความวันนี้ · แจ้งเตือน PC', async () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'สวัสดี', persona: 2 });
    store.pushMessage({
      role: 'assistant',
      content: `${NOTIFY_PREFIX}build เสร็จแล้ว`,
      persona: 1,
    });
    useTabsStore.setState({ activeTab: 'today' });
    await renderApp();
    expect(screen.getByText('คุยวันนี้ · 1 ข้อความ')).toBeTruthy();
    expect(screen.getByText('build เสร็จแล้ว')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('เพิ่มงานใหม่'), 'ส่งรายงาน');
    await fireEvent.press(screen.getByLabelText('เพิ่มงาน'));
    expect(screen.getByRole('checkbox', { name: 'ส่งรายงาน' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'ส่งรายงาน' }));
    expect(nth(useTodayStore.getState().tasks, 0).done).toBe(true);
  });
});

describe('ปุ่ม + บนหน้าหลัก', () => {
  test('เลือกรูป → ชิปเหนือช่องพิมพ์ · ส่งได้โดยไม่พิมพ์ · ข้อความบอสมีไฟล์แนบ · ชิปหายหลังส่ง', async () => {
    mockFetch([[GEMINI, () => geminiText('เห็นรูปแล้วครับ')]]);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/cat.jpg',
          width: 1,
          height: 1,
          fileName: 'cat.jpg',
          mimeType: 'image/jpeg',
          fileSize: 10,
        },
      ],
    } as never);
    await renderApp();
    await fireEvent.press(screen.getByLabelText('เพิ่ม'));
    await fireEvent.press(screen.getByLabelText('รูปภาพ'));
    await settle();
    expect(screen.getByLabelText('เอาไฟล์ cat.jpg ออก')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('ส่งข้อความ'));
    await settle();
    await settle();
    const msgs = useAtomStore.getState().messagesByPersona[1];
    expect(nth(msgs, 0).attachments?.[0]?.name).toBe('cat.jpg');
    expect(msgs.some((m) => m.content === 'เห็นรูปแล้วครับ')).toBe(true);
    expect(screen.queryByLabelText('เอาไฟล์ cat.jpg ออก')).toBeNull();
  });

  test('NotebookLM ในเมนู → ใส่ข้อความตั้งต้นลงช่องพิมพ์', async () => {
    await renderApp();
    await fireEvent.press(screen.getByLabelText('เพิ่ม'));
    await fireEvent.press(screen.getByLabelText('ส่งเข้า NotebookLM'));
    expect(screen.getByLabelText('ช่องพิมพ์ข้อความ').props.value).toBe('ส่งเข้า NotebookLM: ');
  });
});
