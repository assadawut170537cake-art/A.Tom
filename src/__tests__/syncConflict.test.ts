/**
 * 4.5.4.3 — ตรวจระบบ Conflict Log (50 รายการ + ล้างประวัติ) และการ merge แบบ LWW + tombstone
 * เทียบกับ Mark 55 จำลอง (FakeMark55Server) ที่ใช้กติกาเดียวกับ server 4.5.4.1
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import {
  MAX_CONFLICT_LOG,
  SYNC_STORAGE_KEYS,
  SyncQueue,
  resolveConflict,
  type ConflictLogEntry,
} from '../core/memory/SyncQueue';
import { ALL_MEMORY_TARGETS, type MemoryTarget, type SyncFact } from '../core/memory/types';
import { FakeMark55Server, fakeRemote } from '../test-utils/fakeMark55';
import { nth } from '../test-utils/nth';

const GLOBAL: MemoryTarget = { scope: 'global' };
const FRIDAY: MemoryTarget = { scope: 'persona', persona: 3 };
const DAY = 24 * 60 * 60 * 1000;

const fact = (key: string, value: string, updatedAt: number, target: MemoryTarget = GLOBAL): SyncFact => ({
  target,
  key,
  value,
  updatedAt,
  deleted: false,
});
const tombstone = (key: string, updatedAt: number, target: MemoryTarget = GLOBAL): SyncFact => ({
  target,
  key,
  value: '',
  updatedAt,
  deleted: true,
});

const noTriggers = { onForeground: () => () => {}, onOnline: () => () => {} };

/** AsyncStorage แยกต่อเครื่อง (เครื่องจริงแต่ละเครื่องมี storage ของตัวเอง) */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void map.set(k, v)),
  };
}

/** นาฬิกาเครื่อง (Date.now) ที่ test เลื่อนเอง — ให้ลำดับ updatedAt แน่นอน */
let wall: number;

interface Device {
  memory: LocalMemoryAdapter;
  queue: SyncQueue;
  storage: ReturnType<typeof memoryStorage>;
}

const devices: Device[] = [];

function device(name: string, server: FakeMark55Server): Device {
  const memory = new LocalMemoryAdapter(`test.${name}.memory.`);
  const storage = memoryStorage();
  const queue = new SyncQueue({ local: memory, targets: ALL_MEMORY_TARGETS, storage, triggers: noTriggers, now: () => wall });
  queue.setRemote(server.client());
  const d = { memory, queue, storage };
  devices.push(d);
  return d;
}

/** ค่าที่เครื่องเห็น (null = ไม่มี) */
const valueOn = async (d: Device, key: string, target: MemoryTarget = GLOBAL) =>
  (await d.memory.load(target, key))?.value ?? null;

/** เลื่อนนาฬิกาเครื่องไปข้างหน้า แล้วบันทึก/ลบ */
async function edit(d: Device, key: string, value: string | null, target: MemoryTarget = GLOBAL) {
  wall += 1000;
  if (value === null) await d.memory.remove(target, key);
  else await d.memory.save(target, key, value);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  wall = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => wall);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const d of devices.splice(0)) d.queue.dispose();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// 1. Conflict Log
// ---------------------------------------------------------------------------------------------

describe('Conflict Log — newest 50 on this device', () => {
  /** สร้าง conflict n ตัว (server ใหม่กว่าทุกตัว) ในการ flush รอบเดียว */
  async function makeConflicts(queue: SyncQueue, n: number, offset = 0) {
    const remote = fakeRemote();
    queue.setRemote(remote.remote);
    for (let i = 0; i < n; i++) queue.enqueue(fact(`k${offset + i}`, 'mine', 1));
    remote.serverPulls(Array.from({ length: n }, (_, i) => fact(`k${offset + i}`, 'theirs', 2)));
    await queue.flush();
  }

  const freshQueue = (storage = memoryStorage()) => {
    const q = new SyncQueue({ local: new LocalMemoryAdapter(), targets: ALL_MEMORY_TARGETS, storage, triggers: noTriggers });
    devices.push({ memory: new LocalMemoryAdapter(), queue: q, storage });
    return q;
  };
  const storedLog = (storage: ReturnType<typeof memoryStorage>) =>
    JSON.parse(storage.map.get(SYNC_STORAGE_KEYS.conflicts) ?? '[]') as ConflictLogEntry[];

  test('exactly 50 kept across several syncs: newest first, oldest dropped, persisted the same', async () => {
    const storage = memoryStorage();
    const queue = freshQueue(storage);
    await makeConflicts(queue, 30, 0);
    await makeConflicts(queue, 30, 30); // รวม 60 → เหลือ 50 ล่าสุด (k10..k59)
    const log = queue.getSnapshot().conflicts;
    expect(log).toHaveLength(MAX_CONFLICT_LOG);
    expect(nth(log, 0).key).toBe('k59');
    expect(nth(log, -1).key).toBe('k10');
    expect(new Set(log.map((c) => c.id)).size).toBe(50); // id ไม่ซ้ำ (ใช้เป็น React key)
    await new Promise((r) => setImmediate(r));
    expect(storedLog(storage).map((c) => c.key)).toEqual(log.map((c) => c.key));
  });

  test('each entry records both sides and who won', async () => {
    const queue = freshQueue();
    const remote = fakeRemote();
    queue.setRemote(remote.remote);
    queue.enqueue(tombstone('gone', 10));
    remote.serverPulls([fact('gone', 'ยังอยู่', 5)]);
    await queue.flush();
    expect(nth(queue.getSnapshot().conflicts, 0)).toMatchObject({
      key: 'gone',
      target: GLOBAL,
      localValue: null, // ฝั่งเครื่องนี้ = ลบ
      serverValue: 'ยังอยู่',
      resolvedTo: 'server',
    });
  });

  test('a stored log longer than 50 (older build / hand-edited) is trimmed on restore', async () => {
    const storage = memoryStorage();
    const entries = Array.from({ length: 70 }, (_, i) => ({
      id: `c${i}`,
      target: GLOBAL,
      key: `k${i}`,
      localValue: 'a',
      serverValue: 'b',
      resolvedTo: 'server',
      at: i,
    }));
    storage.map.set(SYNC_STORAGE_KEYS.conflicts, JSON.stringify(entries));
    const queue = freshQueue(storage);
    await queue.restore();
    expect(queue.getSnapshot().conflicts).toHaveLength(50);
    expect(nth(queue.getSnapshot().conflicts, 0).id).toBe('c0');
  });

  test('clear empties memory + storage and stays empty after reopening the app', async () => {
    const storage = memoryStorage();
    const queue = freshQueue(storage);
    await makeConflicts(queue, 3);
    await queue.clearConflicts();
    expect(queue.getSnapshot().conflicts).toEqual([]);
    expect(storedLog(storage)).toEqual([]);

    const reopened = freshQueue(storage);
    await reopened.restore();
    expect(reopened.getSnapshot().conflicts).toEqual([]);
  });

  test('clear pressed before the saved log finished loading is not undone by the load', async () => {
    const storage = memoryStorage();
    storage.map.set(SYNC_STORAGE_KEYS.conflicts, JSON.stringify([
      { id: 'old', target: GLOBAL, key: 'k', localValue: 'a', serverValue: 'b', resolvedTo: 'server', at: 1 },
    ]));
    const queue = freshQueue(storage);
    await queue.clearConflicts(); // ยังไม่เคย restore
    expect(queue.getSnapshot().conflicts).toEqual([]);
    await queue.restore();
    expect(queue.getSnapshot().conflicts).toEqual([]);
    expect(storedLog(storage)).toEqual([]);
  });

  test('auto-sync switched on before the saved settings loaded stays on', async () => {
    const storage = memoryStorage();
    storage.map.set(SYNC_STORAGE_KEYS.autoSync, 'false');
    const queue = freshQueue(storage);
    await queue.setAutoSync(true);
    await queue.restore();
    expect(queue.getSnapshot().autoSyncEnabled).toBe(true);
    expect(storage.map.get(SYNC_STORAGE_KEYS.autoSync)).toBe('true');
  });

  test('a conflict that ends in the same value is not logged', async () => {
    const queue = freshQueue();
    const remote = fakeRemote();
    queue.setRemote(remote.remote);
    queue.enqueue(fact('same', 'v', 1));
    remote.serverPulls([fact('same', 'v', 9)]);
    await queue.flush();
    expect(queue.getSnapshot().conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. LWW + tombstone — ตารางกติกา
// ---------------------------------------------------------------------------------------------

describe('resolveConflict() — the full rule table', () => {
  test.each`
    local                 | server                | winner      | why
    ${fact('k', 'a', 1)}  | ${fact('k', 'b', 2)}  | ${'server'} | ${'update vs update: server newer'}
    ${fact('k', 'a', 2)}  | ${fact('k', 'b', 1)}  | ${'local'}  | ${'update vs update: local newer'}
    ${fact('k', 'a', 2)}  | ${fact('k', 'b', 2)}  | ${'local'}  | ${'update vs update: tie → local (server decides on push)'}
    ${tombstone('k', 9)}  | ${fact('k', 'b', 1)}  | ${'server'} | ${'local delete vs server update → update wins even if older'}
    ${fact('k', 'a', 1)}  | ${tombstone('k', 9)}  | ${'local'}  | ${'local update vs server delete → update wins even if older'}
    ${tombstone('k', 1)}  | ${tombstone('k', 2)}  | ${'server'} | ${'delete vs delete: server newer'}
    ${tombstone('k', 2)}  | ${tombstone('k', 1)}  | ${'local'}  | ${'delete vs delete: local newer'}
  `('$why', ({ local, server, winner }: { local: SyncFact; server: SyncFact; winner: string }) => {
    expect(resolveConflict(local, server)).toBe(winner);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. สองเครื่องผ่าน Mark 55 จำลอง — ต้องลงเอยตรงกันเสมอ
// ---------------------------------------------------------------------------------------------

describe('two devices through Mark 55 converge', () => {
  /** ซิงก์สลับกันจนนิ่ง (เหมือน auto-sync หลายรอบ) */
  async function syncAll(...ds: Device[]) {
    for (let round = 0; round < 3; round++) for (const d of ds) expect((await d.queue.flush()).ok).toBe(true);
  }

  test('a new fact and an edit on one device reach the other', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'nickname', 'ต้น');
    await edit(a, 'joke', 'มุก 2499', FRIDAY);
    await syncAll(a, b);
    expect(await valueOn(b, 'nickname')).toBe('ต้น');
    expect(await valueOn(b, 'joke', FRIDAY)).toBe('มุก 2499');

    await edit(b, 'nickname', 'เค้ก');
    await syncAll(a, b);
    expect(await valueOn(a, 'nickname')).toBe('เค้ก');
    expect(a.queue.getSnapshot().conflicts).toEqual([]);
  });

  test('a delete travels as a tombstone and removes the fact on the other device', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'drink', 'กาแฟ');
    await syncAll(a, b);
    await edit(b, 'drink', null);
    await syncAll(a, b);
    expect(await valueOn(a, 'drink')).toBeNull();
    expect(server.get(GLOBAL, 'drink')).toMatchObject({ deleted: true });
    // tombstone ที่ส่งกลับมาไม่ถูก log เป็น conflict และไม่ทำให้เกิดอะไรเพิ่ม
    expect([...a.queue.getSnapshot().conflicts, ...b.queue.getSnapshot().conflicts]).toEqual([]);
  });

  test('clear() on one device deletes every key of that scope on the other', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'x', '1', FRIDAY);
    await edit(a, 'y', '2', FRIDAY);
    await edit(a, 'keep', 'g');
    await syncAll(a, b);
    wall += 1000;
    await b.memory.clear(FRIDAY);
    await syncAll(a, b);
    expect(await a.memory.list(FRIDAY)).toEqual([]);
    expect(await valueOn(a, 'keep')).toBe('g');
  });

  test('concurrent edits: the newer one wins on both devices; only the loser logs a conflict', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'drink', 'กาแฟ');
    await syncAll(a, b);

    await edit(a, 'drink', 'ชา'); // ออฟไลน์ทั้งคู่ แก้ key เดียวกัน
    await edit(b, 'drink', 'โกโก้'); // ใหม่กว่า
    await b.queue.flush(); // b ขึ้นก่อน
    await a.queue.flush(); // a ใหม่น้อยกว่า → แพ้
    await syncAll(a, b);

    expect(await valueOn(a, 'drink')).toBe('โกโก้');
    expect(await valueOn(b, 'drink')).toBe('โกโก้');
    expect(a.queue.getSnapshot().conflicts).toEqual([
      expect.objectContaining({ key: 'drink', localValue: 'ชา', serverValue: 'โกโก้', resolvedTo: 'server' }),
    ]);
    expect(b.queue.getSnapshot().conflicts).toEqual([]); // ฝั่งชนะไม่ log
  });

  test('the newer local edit wins even when the older one reached the server first', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'drink', 'ชา'); // เก่ากว่า
    await edit(b, 'drink', 'โกโก้'); // ใหม่กว่า
    await a.queue.flush();
    await b.queue.flush();
    await syncAll(a, b);
    expect(await valueOn(a, 'drink')).toBe('โกโก้');
    expect(await valueOn(b, 'drink')).toBe('โกโก้');
    expect(b.queue.getSnapshot().conflicts).toEqual([]); // b ชนะ → ไม่ log
  });

  test('delete vs concurrent update → the update survives on both devices (even when the delete is newer)', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'drink', 'กาแฟ');
    await syncAll(a, b);

    await edit(b, 'drink', 'ชาเย็น'); // update (เก่ากว่า)
    await edit(a, 'drink', null); // delete (ใหม่กว่า)
    await b.queue.flush();
    await a.queue.flush();
    await syncAll(a, b);

    expect(await valueOn(a, 'drink')).toBe('ชาเย็น');
    expect(await valueOn(b, 'drink')).toBe('ชาเย็น');
    expect(server.get(GLOBAL, 'drink')).toMatchObject({ value: 'ชาเย็น', deleted: false });
    expect(nth(a.queue.getSnapshot().conflicts, 0)).toMatchObject({ localValue: null, serverValue: 'ชาเย็น' });
  });

  test('delete reaching the server first, then a concurrent update → update still wins', async () => {
    const server = new FakeMark55Server();
    const [a, b] = [device('a', server), device('b', server)];
    await edit(a, 'drink', 'กาแฟ');
    await syncAll(a, b);

    await edit(b, 'drink', 'ชาเย็น');
    await edit(a, 'drink', null);
    await a.queue.flush(); // tombstone ขึ้นก่อน
    await b.queue.flush(); // update ของ b ชนะ tombstone ที่ server
    await syncAll(a, b);
    expect(await valueOn(a, 'drink')).toBe('ชาเย็น');
    expect(await valueOn(b, 'drink')).toBe('ชาเย็น');
  });

  test('a push by another device between our pull and push is not lost (lastSyncAt = pull time)', async () => {
    const server = new FakeMark55Server();
    const a = device('a', server);
    const client = server.client();
    // ห่อ push ของ a: ระหว่าง pull กับ push เครื่องอื่นแอบ push เข้ามา
    a.queue.setRemote({
      pull: client.pull,
      push: async (facts, last) => {
        server.seed(fact('fromB', 'แทรกกลางทาง', 1));
        return client.push(facts, last);
      },
    });
    await edit(a, 'mine', 'x');
    await a.queue.flush();
    a.queue.setRemote(client);
    await a.queue.flush();
    expect(await valueOn(a, 'fromB')).toBe('แทรกกลางทาง');
  });

  test('a rejection without the server copy triggers a full pull next round and converges', async () => {
    const memory = new LocalMemoryAdapter('test.r.memory.');
    const queue = new SyncQueue({ local: memory, targets: ALL_MEMORY_TARGETS, storage: memoryStorage(), triggers: noTriggers });
    devices.push({ memory, queue, storage: memoryStorage() });
    const remote = fakeRemote();
    queue.setRemote(remote.remote);
    await queue.flush(); // lastSyncAt > 0
    await memory.save(GLOBAL, 'drink', 'ของเครื่อง');
    remote.serverRejects([{ target: GLOBAL, key: 'drink', server: null }]); // server รุ่นที่ไม่ส่งฉบับของมันมาด้วย
    await queue.flush();
    expect(queue.getSnapshot()).toMatchObject({ lastSyncAt: 0, queue: [] });

    remote.serverPulls([fact('drink', 'ของ server', wall + 1)]);
    await queue.flush();
    expect(nth(remote.pulls, -1)).toBe(0); // ดึงใหม่ทั้งหมด
    expect(await memory.load(GLOBAL, 'drink')).toMatchObject({ value: 'ของ server' });
  });

  test('a device clock more than 1 day ahead → server rejects (400); the change stays queued, no retry loop', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const server = new FakeMark55Server();
      const a = device('a', server);
      wall = server.now + 2 * DAY;
      await a.memory.save(GLOBAL, 'future', 'x');
      const res = await a.queue.flush();
      expect(res).toMatchObject({ ok: false, pending: 1 });
      expect(res.error).toContain('1 วัน');
      expect(a.queue.getSnapshot().lastError).toMatchObject({ kind: 'bad_request' });
      const pushes = jest.spyOn(server, 'client'); // ไม่มี client ใหม่ — แค่ยืนยันว่าไม่มี timer ค้าง
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(jest.getTimerCount()).toBe(0);
      expect(pushes).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
