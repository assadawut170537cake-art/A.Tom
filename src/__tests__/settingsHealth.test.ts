import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  quarantineKey,
  SettingsHealth,
  type HealthEntry,
  type SettingsHealthKV,
  type SnapshotTaker,
} from '../core/selfRepair/SettingsHealth';
import type { RepairAttempt } from '../core/selfRepair/types';
import { isArray, isString } from '../core/types/guards';
import { settingsHealthEntries } from '../features/settings/settingsHealthEntries';

const KEY = 'atom.test.blob';
const isStringArray = (v: unknown): v is string[] => isArray(v) && v.every(isString);

function fakeKV(
  initial: Record<string, string> = {},
): SettingsHealthKV & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: async (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

const okSnapshots = (): SnapshotTaker => ({ capture: async () => ({}) });

function setup(
  initial: Record<string, string>,
  opts: {
    snapshots?: SnapshotTaker;
    reset?: () => Promise<void>;
    kv?: ReturnType<typeof fakeKV>;
  } = {},
) {
  const kv = opts.kv ?? fakeKV(initial);
  const notifications: string[] = [];
  const logs: RepairAttempt[] = [];
  const health = new SettingsHealth({
    kv,
    snapshots: opts.snapshots ?? okSnapshots(),
    now: () => 777,
    notify: (m) => notifications.push(m),
    log: async (a) => void logs.push(a),
  });
  const entry: HealthEntry = {
    key: KEY,
    label: 'บล็อกทดสอบ',
    guard: isStringArray,
    reset: opts.reset ?? (async () => void kv.map.set(KEY, '["default"]')),
  };
  return { kv, notifications, logs, health, entry };
}

describe('SettingsHealth — ตรวจ+กู้การตั้งค่าอย่างปลอดภัย (DeepSeek Q1)', () => {
  test('1. blob ปกติ → ไม่แตะ ไม่แจ้ง ไม่ log', async () => {
    const { health, entry, notifications, logs, kv } = setup({ [KEY]: '["a","b"]' });
    const [res] = await health.check([entry]);
    expect(res).toMatchObject({ status: 'ok', action: 'none' });
    expect(notifications).toHaveLength(0);
    expect(logs).toHaveLength(0);
    expect(kv.map.get(KEY)).toBe('["a","b"]'); // ของเดิมอยู่ครบ
  });

  test('2. parse_fail → snapshot + reset + ตรวจซ้ำผ่าน + แจ้งบอส + log success', async () => {
    const snap = jest.fn(async () => ({}));
    const { health, entry, notifications, logs, kv } = setup(
      { [KEY]: '{ พัง ไม่ใช่ json' },
      { snapshots: { capture: snap } },
    );
    const [res] = await health.check([entry]);
    expect(res).toMatchObject({ status: 'parse_fail', action: 'reset', snapshotFailed: false });
    expect(snap).toHaveBeenCalledTimes(1); // snapshot ก่อน reset
    expect(kv.map.get(KEY)).toBe('["default"]'); // กู้เป็น default
    expect(logs[0]).toMatchObject({ method: 'reset', outcome: 'success' });
    expect(notifications[0]).toContain('กู้เป็นค่าเริ่มต้น');
  });

  test('3. schema_fail → กักกัน (ไม่ reset) + ย้าย raw ไป quarantine + แจ้งบอส', async () => {
    const reset = jest.fn(async () => undefined);
    const { health, entry, notifications, logs, kv } = setup(
      { [KEY]: '{"wrong":"shape"}' }, // JSON ถูกแต่ไม่ผ่าน guard (ไม่ใช่ string[])
      { reset },
    );
    const [res] = await health.check([entry]);
    expect(res).toMatchObject({ status: 'schema_fail', action: 'quarantine' });
    expect(reset).not.toHaveBeenCalled(); // ห้าม auto-reset
    expect(kv.map.get(KEY)).toBeUndefined(); // key จริงถูกเคลียร์
    expect(kv.map.get(quarantineKey(KEY))).toBe('{"wrong":"shape"}'); // raw ถูกเก็บไว้กู้ได้
    expect(logs[0]).toMatchObject({ outcome: 'fail', note: 'schema_fail quarantined' });
    expect(notifications[0]).toContain('เก็บสำรอง');
  });

  test('4. snapshot ล้ม → ซ่อมต่อ แต่ log snapshotFailed:true', async () => {
    const { health, entry, logs, kv } = setup(
      { [KEY]: 'not json at all' },
      { snapshots: { capture: async () => Promise.reject(new Error('storage ล่ม')) } },
    );
    const [res] = await health.check([entry]);
    expect(res).toMatchObject({ action: 'reset', snapshotFailed: true });
    expect(kv.map.get(KEY)).toBe('["default"]'); // ยัง reset ได้
    expect(logs[0]).toMatchObject({ outcome: 'success', snapshotFailed: true });
  });

  test('5. reset แล้วยังเสีย → หยุด ไม่ retry + log fail + แจ้งบอสว่ากู้ไม่สำเร็จ', async () => {
    const reset = jest.fn(async () => undefined); // reset ไม่ได้แก้อะไร → ยัง parse_fail
    const { health, entry, notifications, logs } = setup({ [KEY]: 'still broken' }, { reset });
    const [res] = await health.check([entry]);
    expect(res).toMatchObject({ action: 'reset-failed' });
    expect(reset).toHaveBeenCalledTimes(1); // ลองครั้งเดียว ไม่ retry
    expect(logs[0]).toMatchObject({ outcome: 'fail', note: 'still invalid after reset' });
    expect(notifications[0]).toContain('ไม่สำเร็จ');
  });
});

describe('settingsHealthEntries — รายการ blob จริง (PR-4b)', () => {
  test('มี key ครบ ไม่ซ้ำ + reset ลบ key ออกจาก storage', async () => {
    const entries = settingsHealthEntries();
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length); // ไม่ซ้ำ
    expect(keys).toEqual(
      expect.arrayContaining([
        'atom.modules.v1.enabled',
        'atom.ai.v1.customProviders',
        'atom.mcp.v1.servers',
        'atom.skills.v1',
        'atom.voice.v1.standby',
      ]),
    );
    // reset = ลบ key → ตกไปใช้ default ของโมดูล
    const first = entries[0];
    if (!first) throw new Error('no entries');
    await AsyncStorage.setItem(first.key, '{"x":1}');
    await first.reset();
    expect(await AsyncStorage.getItem(first.key)).toBeNull();
  });
});
