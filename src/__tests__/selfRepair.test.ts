import AsyncStorage from '@react-native-async-storage/async-storage';

import { SelfRepair, type RepairMethod } from '../core/selfRepair/SelfRepair';
import { MAX_SNAPSHOTS, SnapshotStore, type SnapshotKV } from '../core/selfRepair/SnapshotStore';

/** KV ปลอมในหน่วยความจำสำหรับ "key เป้าหมาย" ที่จะถ่าย/ย้อน */
function fakeKV(initial: Record<string, string> = {}): SnapshotKV & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    multiGet: async (keys) => keys.map((k) => [k, map.has(k) ? (map.get(k) as string) : null]),
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

let clock = 1000;
const now = () => (clock += 1);

beforeEach(async () => {
  await AsyncStorage.clear(); // ล้าง index/log (เก็บใน AsyncStorage mock)
  clock = 1000;
});

describe('SnapshotStore', () => {
  test('capture แล้ว restore คืนค่าเดิม · key ที่ตอนถ่ายไม่มี = ย้อนแล้วถูกลบ', async () => {
    const kv = fakeKV({ A: '1' }); // B ยังไม่มี
    const store = new SnapshotStore({ kv, now });
    const snap = await store.capture('แก้ A', ['A', 'B']);

    kv.map.set('A', '2'); // แก้ค่า
    kv.map.set('B', '9'); // เพิ่ม key ใหม่
    expect(await store.restore(snap.id)).toBe(true);

    expect(kv.map.get('A')).toBe('1'); // ย้อนค่าเดิม
    expect(kv.map.has('B')).toBe(false); // ตอนถ่ายไม่มี → ย้อน = ลบ
  });

  test('เก็บซ้อนไม่เกิน MAX_SNAPSHOTS (ตัดเก่าสุด)', async () => {
    const store = new SnapshotStore({ kv: fakeKV({ A: '1' }), now });
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) await store.capture(`รอบ ${i}`, ['A']);
    const list = await store.list();
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0]?.label).toBe('รอบ 2'); // 0,1 ถูกตัด
    expect(list.at(-1)?.label).toBe(`รอบ ${MAX_SNAPSHOTS + 1}`);
  });

  test('restore id ที่ไม่มี = false', async () => {
    const store = new SnapshotStore({ kv: fakeKV(), now });
    expect(await store.restore('ไม่มีจริง')).toBe(false);
  });
});

describe('SelfRepair', () => {
  const makeRepair = (kv: SnapshotKV) =>
    new SelfRepair({ snapshots: new SnapshotStore({ kv, now }), now });

  test('วิธีแรกล้ม → ย้อน → วิธีสองสำเร็จ → ลบ snapshot + บันทึกผล', async () => {
    const kv = fakeKV({ setting: 'เดิม' });
    const repair = makeRepair(kv);

    const bad: RepairMethod = {
      name: 'วิธีพัง',
      run: async () => {
        await kv.setItem('setting', 'ค่าผิด');
        return false; // ไม่สำเร็จ
      },
    };
    const good: RepairMethod = {
      name: 'วิธีดี',
      run: async () => {
        await kv.setItem('setting', 'ค่าที่ถูก');
        return true;
      },
    };

    const res = await repair.repair('setting เสีย', ['setting'], [bad, good]);
    expect(res.ok).toBe(true);
    expect(res.method).toBe('วิธีดี');
    expect(res.tried).toEqual(['วิธีพัง', 'วิธีดี']);
    expect(kv.map.get('setting')).toBe('ค่าที่ถูก'); // ค่าสุดท้าย = ของวิธีที่สำเร็จ
    expect(await repair['snapshots'].list()).toHaveLength(0); // สำเร็จแล้วลบ snapshot

    const hist = await repair.history();
    expect(hist.map((h) => h.outcome)).toEqual(['fail', 'success']);
  });

  test('ทุกวิธีล้ม → ย้อนไว้ที่เดิม + ไม่มี snapshot ค้าง', async () => {
    const kv = fakeKV({ setting: 'เดิม' });
    const repair = makeRepair(kv);
    const bad: RepairMethod = {
      name: 'พัง1',
      run: async () => {
        await kv.setItem('setting', 'พังชั่วคราว');
        return false;
      },
    };
    const boom: RepairMethod = {
      name: 'พัง2',
      run: async () => {
        throw new Error('ระเบิด'); // throw = ถือว่าล้ม ไม่ทำให้ลูปพัง
      },
    };
    const res = await repair.repair('x', ['setting'], [bad, boom]);
    expect(res.ok).toBe(false);
    expect(res.tried).toEqual(['พัง1', 'พัง2']);
    expect(kv.map.get('setting')).toBe('เดิม'); // ย้อนไว้ที่เดิม
    expect(await repair['snapshots'].list()).toHaveLength(0);
  });

  test('ครั้งหน้าซ่อมเร็วขึ้น: วิธีที่เคยสำเร็จกับปัญหานี้ถูกลองก่อน', async () => {
    const kv = fakeKV({ s: '0' });
    const repair = makeRepair(kv);
    const a: RepairMethod = { name: 'A', run: async () => false };
    const b: RepairMethod = { name: 'B', run: async () => true };

    // รอบแรก: ลอง A (ล้ม) แล้ว B (สำเร็จ)
    const first = await repair.repair('ปัญหาซ้ำ', ['s'], [a, b]);
    expect(first.tried).toEqual(['A', 'B']);

    // รอบสอง: B เคยสำเร็จ → ถูกเลื่อนขึ้นก่อน A
    const second = await repair.repair('ปัญหาซ้ำ', ['s'], [a, b]);
    expect(second.tried[0]).toBe('B');
    expect(second.ok).toBe(true);
  });

  test('ดูผลครั้งล่าสุด: วิธีที่เคยสำเร็จแต่ตอนนี้ล้มตลอด ไม่ถูกดันขึ้นหน้าอีก', async () => {
    const kv = fakeKV({ s: '0' });
    const repair = makeRepair(kv);
    let bWorks = true;
    const b: RepairMethod = { name: 'B', run: async () => bWorks };
    const c: RepairMethod = { name: 'C', run: async () => true };

    // รอบแรก: B สำเร็จ (ลองก่อน C ตามลำดับที่ส่ง)
    expect((await repair.repair('P', ['s'], [b, c])).method).toBe('B');

    // ต่อมา B พังถาวร → รอบนี้ B ถูกลองก่อน (เพราะเคยสำเร็จ) แต่ล้ม → ตก C
    bWorks = false;
    const r2 = await repair.repair('P', ['s'], [b, c]);
    expect(r2.tried).toEqual(['B', 'C']);
    expect(r2.method).toBe('C');

    // รอบถัดไป: ผลล่าสุดของ B = fail, C = success → C ต้องถูกลองก่อน B
    const r3 = await repair.repair('P', ['s'], [b, c]);
    expect(r3.tried[0]).toBe('C');
  });

  test('restore ล้ม (storage ล่ม) หลังวิธีแรกพัง → หยุด ไม่ลองวิธีถัดไป', async () => {
    const kv = fakeKV({ s: 'เดิม' });
    const snapshots = new SnapshotStore({ kv, now });
    // บังคับให้ restore โยน error
    jest.spyOn(snapshots, 'restore').mockRejectedValue(new Error('storage ล่ม'));
    const repair = new SelfRepair({ snapshots, now });

    const second = jest.fn(async () => true);
    const res = await repair.repair(
      'x',
      ['s'],
      [
        { name: 'พัง', run: async () => false },
        { name: 'ไม่ควรถูกเรียก', run: second },
      ],
    );
    expect(res.ok).toBe(false);
    expect(res.tried).toEqual(['พัง']); // หยุดหลังย้อนไม่สำเร็จ
    expect(second).not.toHaveBeenCalled();
  });
});
