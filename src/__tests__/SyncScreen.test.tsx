import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderError } from '../core/http/errors';
import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import { MemorySync } from '../core/memory/MemorySync';
import { SYNC_STORAGE_KEYS, SyncQueue } from '../core/memory/SyncQueue';
import { SUPERMEMORY_KEY_NAME } from '../core/memory/SuperMemorySync';
import { ALL_MEMORY_TARGETS, type MemoryTarget } from '../core/memory/types';
import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { SyncScreen, connectionStatus, formatTime } from '../features/settings/screens/SyncScreen';
import { RootNavigator } from '../navigation/RootNavigator';
import { fakeRemote, fakeSecureStore, remoteStub } from '../test-utils/fakeMark55';
import { registerAll } from '../test-utils/setup';

const GLOBAL: MemoryTarget = { scope: 'global' };
const ATOM: MemoryTarget = { scope: 'persona', persona: 1 };
const URL = 'http://192.168.1.10:8787';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** ให้ AsyncStorage (mock แบบ promise) และ await ใน MemorySync จบภายใน act */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));

beforeAll(registerAll);

let memory: LocalMemoryAdapter;
let queue: SyncQueue;
let server: ReturnType<typeof fakeRemote>;
let remote: ReturnType<typeof remoteStub>;
let sync: MemorySync;
let errorSpy: jest.SpyInstance;

const noTriggers = { onForeground: () => () => {}, onOnline: () => () => {} };

beforeEach(async () => {
  await AsyncStorage.clear();
  memory = new LocalMemoryAdapter();
  queue = new SyncQueue({ local: memory, targets: ALL_MEMORY_TARGETS, triggers: noTriggers });
  server = fakeRemote();
  remote = remoteStub(server.remote);
  sync = new MemorySync({
    queue,
    secure: fakeSecureStore(),
    createRemote: () => remote,
    deviceName: 'Pixel ของบอส',
    defaultServerUrl: URL,
  });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  queue.dispose();
  jest.restoreAllMocks();
});

async function renderScreen() {
  await render(<SyncScreen sync={sync} />);
  await settle();
}

async function pairWith(code = '123456') {
  await fireEvent.changeText(screen.getByLabelText('Pairing Code'), code);
  await fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
  await settle();
}

describe('render states', () => {
  test('Supermemory: API key บันทึกลง SecureKeyStore (supermemory.apiKey)', async () => {
    await renderScreen();
    expect(screen.getByText('Supermemory')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Supermemory API key'), '  sm_test_key_0123456789abcdef  ');
    await fireEvent.press(screen.getByRole('button', { name: 'บันทึก' }));
    await settle();
    expect(await SecureKeyStore.get(SUPERMEMORY_KEY_NAME)).toBe('sm_test_key_0123456789abcdef');
    expect(screen.getByLabelText('Supermemory API key บันทึกแล้ว')).toBeTruthy();
    await SecureKeyStore.delete(SUPERMEMORY_KEY_NAME);
  });

  test('unpaired: 🟡, default URL from env/config, pairing code field, no sync section', async () => {
    await renderScreen();
    expect(screen.getByLabelText('สถานะ: ยังไม่จับคู่')).toBeTruthy();
    expect(screen.getByText('🟡')).toBeTruthy();
    expect(screen.getByLabelText('Server URL').props.value).toBe(URL);
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
    expect(screen.queryByText('สถานะการซิงก์')).toBeNull();
    expect(screen.queryByText('ประวัติ Conflict')).toBeNull();
  });

  test('pairing code accepts digits only, max 6; Pair enables at 6 digits', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Pairing Code'), '12a3-45');
    expect(screen.getByLabelText('Pairing Code').props.value).toBe('12345');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Pairing Code'), '1234567');
    expect(screen.getByLabelText('Pairing Code').props.value).toBe('123456');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeEnabled();
  });

  test('paired: 🟢, device name + expiry, URL locked, sync section', async () => {
    await renderScreen();
    await pairWith();
    expect(screen.getByLabelText('สถานะ: เชื่อมต่อแล้ว')).toBeTruthy();
    expect(screen.getByText('Pixel ของบอส')).toBeTruthy();
    expect(screen.getByText(formatTime(2_000_000))).toBeTruthy();
    expect(screen.getByLabelText('Server URL').props.editable).toBe(false);
    expect(screen.getByText('สถานะการซิงก์')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ยกเลิก Pair' })).toBeTruthy();
  });

  test('error: a failed sync shows 🔴 with the Thai reason', async () => {
    await renderScreen();
    await pairWith();
    server.failWith(new ProviderError('mark55', 'network', 'เชื่อมต่อ Mark 55 ไม่ได้ — ตรวจว่า server เปิดอยู่'));
    await fireEvent.press(screen.getByRole('button', { name: 'ซิงก์ตอนนี้' }));
    await settle();
    expect(screen.getByLabelText('สถานะ: เชื่อมต่อไม่ได้')).toBeTruthy();
    expect(screen.getAllByText('เชื่อมต่อ Mark 55 ไม่ได้ — ตรวจว่า server เปิดอยู่').length).toBeGreaterThan(0);
  });

  test('connectionStatus(): the newest signal wins', () => {
    const base = queue.getSnapshot();
    expect(connectionStatus(base, null)).toBe('unpaired');
    const paired = { ...base, paired: true };
    expect(connectionStatus(paired, null)).toBe('connected');
    expect(connectionStatus(paired, { ok: false, at: 1 })).toBe('offline');
    const failed = { ...paired, lastError: { kind: 'network' as const, message: 'x', at: 5 } };
    expect(connectionStatus(failed, { ok: true, at: 1 })).toBe('offline');
    expect(connectionStatus(failed, { ok: true, at: 9 })).toBe('connected');
  });
});

describe('server connection', () => {
  test('"ทดสอบการเชื่อมต่อ" saves the typed URL and calls health()', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Server URL'), '192.168.1.20:8787/');
    await fireEvent.press(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }));
    await settle();
    expect(remote.health).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('mark55.sync.serverUrl')).toBe('http://192.168.1.20:8787');
    expect(screen.getByLabelText('Server URL').props.value).toBe('http://192.168.1.20:8787');
    expect(screen.getByText('เชื่อมต่อได้ · Mark 55 v0.1.0 — จับคู่ต่อได้เลย')).toBeTruthy();
  });

  test('an invalid URL is rejected before any request', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Server URL'), 'http://8.8.8.8:8787');
    await fireEvent.press(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }));
    await settle();
    expect(remote.health).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/https:\/\//);
  });

  test('server down → error notice', async () => {
    remote.health.mockRejectedValueOnce(new ProviderError('mark55', 'timeout', 'Mark 55 ไม่ตอบภายใน 10 วินาที'));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Mark 55 ไม่ตอบภายใน 10 วินาที');
  });
});

describe('pair flow', () => {
  test('success: code sent, facts already in memory pushed, notice shown', async () => {
    await memory.save(GLOBAL, 'nickname', 'ต้น');
    await renderScreen();
    await pairWith('654321');
    expect(remote.pair).toHaveBeenCalledWith('654321', 'Pixel ของบอส');
    expect(screen.getByText('จับคู่สำเร็จ — Pixel ของบอส · กำลังส่งความจำขึ้น Mark 55')).toBeTruthy();
    expect(server.pushes.flatMap((p) => p.facts.map((f) => f.key))).toEqual(['nickname']);
    expect(screen.getByText('0 รายการ')).toBeTruthy();
  });

  test('wrong code (401) → Thai error, still unpaired', async () => {
    remote.pair.mockRejectedValueOnce(
      new ProviderError('mark55', 'auth', 'รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ — ขอรหัสใหม่จาก Mark 55 แล้วลองอีกครั้ง', 401)
    );
    await renderScreen();
    await pairWith('000000');
    expect(screen.getByRole('alert')).toHaveTextContent('รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ — ขอรหัสใหม่จาก Mark 55 แล้วลองอีกครั้ง');
    expect(screen.getByLabelText('สถานะ: ยังไม่จับคู่')).toBeTruthy();
  });

  test('"ยกเลิก Pair" asks first, then forgets the pairing', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await pairWith();
    await fireEvent.press(screen.getByRole('button', { name: 'ยกเลิก Pair' }));
    const buttons: AlertButton[] = alert.mock.calls[0]?.[2] ?? [];
    expect(alert.mock.calls[0]?.[0]).toBe('ยกเลิกการจับคู่?');
    await act(async () => buttons.find((b) => b.text === 'ยกเลิก Pair')?.onPress?.());
    await settle();
    expect(screen.getByLabelText('สถานะ: ยังไม่จับคู่')).toBeTruthy();
    expect(screen.getByText('ยกเลิกการจับคู่แล้ว')).toBeTruthy();
  });
});

describe('sync status', () => {
  test('manual sync: pending count goes up with memory edits and back to 0', async () => {
    await renderScreen();
    await pairWith();
    await act(async () => {
      await memory.save(GLOBAL, 'drink', 'กาแฟดำ');
      await memory.save(ATOM, 'joke', 'มุก 2499');
    });
    expect(screen.getByText('2 รายการ')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'ซิงก์ตอนนี้' }));
    await settle();
    expect(screen.getByText('0 รายการ')).toBeTruthy();
    expect(screen.getByText('ซิงก์แล้ว — ส่ง 2 · รับ 0')).toBeTruthy();
    expect(screen.queryByText('ยังไม่เคย')).toBeNull();
  });

  test('toggle auto-sync is saved', async () => {
    await renderScreen();
    await pairWith();
    expect(screen.getByText('ซิงก์อัตโนมัติ (30s)')).toBeTruthy();
    await fireEvent(screen.getByLabelText('ซิงก์อัตโนมัติ'), 'valueChange', true);
    await settle();
    expect(queue.getSnapshot().autoSyncEnabled).toBe(true);
    expect(await AsyncStorage.getItem(SYNC_STORAGE_KEYS.autoSync)).toBe('true');
    expect(screen.getByLabelText('ซิงก์อัตโนมัติ').props.value).toBe(true);
  });

  test('conflict log lists key, both values and the winner; can be cleared', async () => {
    await renderScreen();
    await pairWith();
    await act(async () => {
      await memory.save(GLOBAL, 'drink', 'ชา');
    });
    server.serverPulls([{ target: GLOBAL, key: 'drink', value: 'กาแฟ', updatedAt: Date.now() + 60_000, deleted: false }]);
    await fireEvent.press(screen.getByRole('button', { name: 'ซิงก์ตอนนี้' }));
    await settle();

    expect(screen.getByText('ประวัติ Conflict')).toBeTruthy();
    expect(screen.getByLabelText('conflict drink')).toBeTruthy();
    expect(screen.getByText('ชา')).toBeTruthy();
    expect(screen.getByText('กาแฟ')).toBeTruthy();
    expect(screen.getByText(/^ของ Server · /)).toBeTruthy();
    expect(screen.getByText('ซิงก์แล้ว — ส่ง 0 · รับ 1 · ขัดแย้ง 1')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'ล้างประวัติ' }));
    await settle();
    expect(screen.queryByText('ประวัติ Conflict')).toBeNull();
  });
});

describe('Settings hub → Sync', () => {
  test('"Sync" sits between Modules and Voice and opens the Sync screen', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await fireEvent.press(await screen.findByLabelText('ตั้งค่า'));
    await screen.findByText('Persona Voice Map');
    const labels = screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel));
    const order = ['Modules', 'Sync', 'Voice (TTS + STT)'].map((l) => labels.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    await fireEvent.press(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('จับคู่อุปกรณ์')).toBeTruthy();
    await settle();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
