import AsyncStorage from '@react-native-async-storage/async-storage';

import { ProviderError } from '../core/http/errors';
import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import { MARK55_TOKEN_KEY, MemorySync } from '../core/memory/MemorySync';
import {
  AUTO_SYNC_INTERVAL_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SYNC_STORAGE_KEYS,
  SyncQueue,
  resolveConflict,
  type SyncTriggers,
} from '../core/memory/SyncQueue';
import { ALL_MEMORY_TARGETS, type MemoryTarget, type SyncFact } from '../core/memory/types';
import { fakeRemote, fakeSecureStore, remoteStub } from '../test-utils/fakeMark55';
import { nth } from '../test-utils/nth';

const GLOBAL: MemoryTarget = { scope: 'global' };
const ATOM: MemoryTarget = { scope: 'persona', persona: 1 };

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

function fakeTriggers() {
  const fire: { foreground?: () => void; online?: () => void } = {};
  const stops = { foreground: jest.fn(), online: jest.fn() };
  const triggers: SyncTriggers = {
    onForeground: (cb) => {
      fire.foreground = cb;
      return stops.foreground;
    },
    onOnline: (cb) => {
      fire.online = cb;
      return stops.online;
    },
  };
  return { triggers, fire, stops };
}

let memory: LocalMemoryAdapter;
let queue: SyncQueue;
let triggers: ReturnType<typeof fakeTriggers>;
let clock: number;
let errorSpy: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  memory = new LocalMemoryAdapter();
  triggers = fakeTriggers();
  clock = 500;
  queue = new SyncQueue({ local: memory, targets: ALL_MEMORY_TARGETS, triggers: triggers.triggers, now: () => clock });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  queue.dispose();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const storedQueue = async () => JSON.parse((await AsyncStorage.getItem(SYNC_STORAGE_KEYS.queue)) ?? '[]') as unknown[];
const settle = () => new Promise((r) => setImmediate(r));

describe('enqueue / dequeue + persist', () => {
  test('enqueue persists every change; the same key replaces the older entry', async () => {
    queue.enqueue(fact('a', '1', 10));
    queue.enqueue(fact('b', '2', 11, ATOM));
    queue.enqueue(fact('a', '3', 12));
    const items = queue.getSnapshot().queue;
    expect(items.map((q) => [q.key, q.value, q.attempts])).toEqual([
      ['b', '2', 0],
      ['a', '3', 0],
    ]);
    await settle();
    expect(await storedQueue()).toEqual(items);

    expect(queue.dequeue(nth(items, 0).id)).toBe(true);
    expect(queue.dequeue('nope')).toBe(false);
    await settle();
    expect((await storedQueue()).length).toBe(1);
  });

  test('a tombstone is stored with an empty value', () => {
    queue.enqueue({ ...fact('a', 'secret', 1), deleted: true });
    expect(nth(queue.getSnapshot().queue, 0)).toMatchObject({ value: '', deleted: true });
  });

  test('restore() brings back the queue, lastSyncAt, conflicts and auto-sync from AsyncStorage', async () => {
    queue.enqueue(fact('a', '1', 10));
    await queue.setAutoSync(true);
    await settle();
    const saved = queue.getSnapshot().queue;
    await AsyncStorage.setItem(SYNC_STORAGE_KEYS.lastSyncAt, '777');

    const reopened = new SyncQueue({ local: memory, targets: ALL_MEMORY_TARGETS, triggers: triggers.triggers });
    reopened.enqueue(fact('b', 'new', 20)); // enqueued before restore finishes → kept
    await reopened.restore();
    expect(reopened.getSnapshot()).toMatchObject({ restored: true, lastSyncAt: 777, autoSyncEnabled: true });
    expect(reopened.getSnapshot().queue.map((q) => q.key)).toEqual(['a', 'b']);
    expect(nth(reopened.getSnapshot().queue, 0)).toEqual(nth(saved, 0));
    reopened.dispose();
  });

  test('corrupt stored data is dropped with a log', async () => {
    await AsyncStorage.setItem(SYNC_STORAGE_KEYS.queue, '[{"bad":true}]');
    await queue.restore();
    expect(queue.getSnapshot().queue).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[sync] mark55.sync.queue: ข้อมูลเสีย — ตัดทิ้ง');
  });

  test('a storage write failure is logged; the in-memory queue keeps working', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('quota'));
    queue.enqueue(fact('a', '1', 1));
    await settle();
    expect(queue.getSnapshot().queue).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('บันทึก mark55.sync.queue ไม่สำเร็จ'), expect.any(Error));
  });
});

describe('local changes while paired', () => {
  test('unpaired: memory changes are not queued (single-device mode unchanged)', async () => {
    await memory.save(GLOBAL, 'a', '1');
    expect(queue.getSnapshot().queue).toEqual([]);
    await expect(queue.flush()).resolves.toMatchObject({ ok: false, skipped: 'unpaired' });
  });

  test('paired: save/remove are queued; unpairing stops listening and the triggers', async () => {
    queue.setRemote(fakeRemote().remote);
    await memory.save(GLOBAL, 'a', '1');
    await memory.remove(GLOBAL, 'a');
    expect(queue.getSnapshot().queue.map((q) => [q.key, q.deleted])).toEqual([['a', true]]);

    queue.setRemote(null);
    expect(triggers.stops.foreground).toHaveBeenCalled();
    expect(triggers.stops.online).toHaveBeenCalled();
    await memory.save(GLOBAL, 'b', '2');
    expect(queue.getSnapshot().queue.map((q) => q.key)).toEqual(['a']);
  });

  test('enqueueAll() queues every existing fact (first pairing)', async () => {
    await memory.save(GLOBAL, 'a', '1');
    await memory.save(ATOM, 'b', '2');
    await expect(queue.enqueueAll()).resolves.toBe(2);
    await expect(queue.enqueueAll()).resolves.toBe(0); // already queued
    expect(queue.getSnapshot().queue.map((q) => q.key).sort()).toEqual(['a', 'b']);
  });
});

describe('flush()', () => {
  test('success: pushes the queue, empties it, stores the server time as lastSyncAt', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    await memory.save(GLOBAL, 'a', '1');
    await memory.save(ATOM, 'b', '2');

    await expect(queue.flush()).resolves.toEqual({ ok: true, pushed: 2, pulled: 0, conflicts: 0, pending: 0 });
    expect(server.pulls).toEqual([0]);
    expect(nth(server.pushes, 0).facts.map((f) => f.key)).toEqual(['a', 'b']);
    expect(nth(server.pushes, 0).facts[0]).toEqual({ target: GLOBAL, key: 'a', value: '1', updatedAt: expect.any(Number), deleted: false });
    expect(queue.getSnapshot()).toMatchObject({ queue: [], lastSyncAt: 1_000_002, currentlySyncing: false, lastError: null });
    await settle();
    expect(await AsyncStorage.getItem(SYNC_STORAGE_KEYS.lastSyncAt)).toBe('1000002');

    await queue.flush();
    expect(server.pulls).toEqual([0, 1_000_002]); // next pull starts from the server time
    expect(server.pushes).toHaveLength(1); // nothing pending → no push
  });

  test('pulled facts are written locally without being queued back', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    server.serverPulls([fact('nickname', 'ต้น', 100), fact('joke', 'มุก', 200, ATOM)]);
    await expect(queue.flush()).resolves.toMatchObject({ ok: true, pulled: 2, pushed: 0 });
    expect(await memory.load(GLOBAL, 'nickname')).toMatchObject({ value: 'ต้น', updatedAt: 100 });
    expect(queue.getSnapshot().queue).toEqual([]);

    server.serverPulls([tombstone('nickname', 300), tombstone('ghost', 300)]);
    await expect(queue.flush()).resolves.toMatchObject({ pulled: 1 }); // ghost: nothing to delete
    expect(await memory.load(GLOBAL, 'nickname')).toBeNull();
  });

  test('echo of our own pushed fact is skipped', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    const mine = await memory.save(GLOBAL, 'a', '1');
    await queue.flush();
    server.serverPulls([fact('a', '1', mine.updatedAt)]);
    await expect(queue.flush()).resolves.toMatchObject({ pulled: 0 });
  });

  test('concurrent flush calls share one run', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('a', '1', 1));
    const [r1, r2] = await Promise.all([queue.flush(), queue.flush()]);
    expect(r1).toBe(r2);
    expect(server.pulls).toHaveLength(1);
  });

  test('a change made during the push stays queued for the next round', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('a', '1', 1));
    jest.mocked(server.remote.push).mockImplementationOnce(async (facts) => {
      queue.enqueue(fact('a', '2', 2)); // บอสแก้อีกครั้งระหว่างรอ server
      return { applied: facts.length, conflicts: [], serverTimestamp: 5 };
    });
    await expect(queue.flush()).resolves.toMatchObject({ pushed: 0, pending: 1 });
    expect(nth(queue.getSnapshot().queue, 0)).toMatchObject({ value: '2' });
  });
});

describe('conflict resolution', () => {
  test('resolveConflict(): update beats delete; otherwise newer wins (tie → local)', () => {
    expect(resolveConflict(tombstone('k', 999), fact('k', 'v', 1))).toBe('server');
    expect(resolveConflict(fact('k', 'v', 1), tombstone('k', 999))).toBe('local');
    expect(resolveConflict(fact('k', 'a', 1), fact('k', 'b', 2))).toBe('server');
    expect(resolveConflict(fact('k', 'a', 2), fact('k', 'b', 1))).toBe('local');
    expect(resolveConflict(fact('k', 'a', 2), fact('k', 'b', 2))).toBe('local');
  });

  test('server newer → server value applied, pending dropped, conflict logged', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('drink', 'ชา', 100));
    server.serverPulls([fact('drink', 'กาแฟ', 200)]);
    clock = 9999;
    await expect(queue.flush()).resolves.toMatchObject({ ok: true, conflicts: 1, pushed: 0, pending: 0 });
    expect(await memory.load(GLOBAL, 'drink')).toMatchObject({ value: 'กาแฟ' });
    expect(server.pushes).toHaveLength(0);
    expect(queue.getSnapshot().conflicts).toEqual([
      {
        id: expect.any(String),
        target: GLOBAL,
        key: 'drink',
        localValue: 'ชา',
        serverValue: 'กาแฟ',
        resolvedTo: 'server',
        at: 9999,
      },
    ]);
    await settle();
    expect(JSON.parse((await AsyncStorage.getItem(SYNC_STORAGE_KEYS.conflicts)) ?? '[]')).toHaveLength(1);
  });

  test('local newer → pushed, no conflict logged', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('drink', 'ชา', 300));
    server.serverPulls([fact('drink', 'กาแฟ', 200)]);
    await expect(queue.flush()).resolves.toMatchObject({ conflicts: 0, pushed: 1 });
    expect(nth(server.pushes, 0).facts).toEqual([fact('drink', 'ชา', 300)]);
    expect(queue.getSnapshot().conflicts).toEqual([]);
  });

  test('local delete vs server update → update wins (even if the delete is newer)', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(tombstone('drink', 900));
    server.serverPulls([fact('drink', 'กาแฟ', 100)]);
    await expect(queue.flush()).resolves.toMatchObject({ conflicts: 1, pushed: 0 });
    expect(await memory.load(GLOBAL, 'drink')).toMatchObject({ value: 'กาแฟ' });
    expect(nth(queue.getSnapshot().conflicts, 0)).toMatchObject({ localValue: null, serverValue: 'กาแฟ' });
  });

  test('local update vs server delete → our update is pushed', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('drink', 'ชา', 100));
    server.serverPulls([tombstone('drink', 900)]);
    await expect(queue.flush()).resolves.toMatchObject({ conflicts: 0, pushed: 1 });
  });

  test('both deleted / same value → resolved quietly', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(tombstone('a', 1));
    queue.enqueue(fact('b', 'same', 1));
    server.serverPulls([tombstone('a', 5), fact('b', 'same', 5)]);
    await expect(queue.flush()).resolves.toMatchObject({ conflicts: 0, pending: 0 });
    expect(server.pushes).toHaveLength(0);
  });

  test('push rejected by the server (its copy is newer) → server copy applied + logged', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('drink', 'ชา', 100));
    queue.enqueue(fact('ok', 'v', 100));
    server.serverRejects([{ target: GLOBAL, key: 'drink', server: fact('drink', 'โกโก้', 150) }]);
    await expect(queue.flush()).resolves.toMatchObject({ ok: true, pushed: 1, conflicts: 1, pending: 0 });
    expect(await memory.load(GLOBAL, 'drink')).toMatchObject({ value: 'โกโก้' });
    expect(nth(queue.getSnapshot().conflicts, 0)).toMatchObject({ key: 'drink', localValue: 'ชา', serverValue: 'โกโก้' });
  });

  test('conflict log keeps the newest 50 and can be cleared', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    for (let i = 0; i < 55; i++) queue.enqueue(fact(`k${i}`, 'mine', 1));
    server.serverPulls(Array.from({ length: 55 }, (_, i) => fact(`k${i}`, 'theirs', 2)));
    await queue.flush();
    expect(queue.getSnapshot().conflicts).toHaveLength(50);
    expect(nth(queue.getSnapshot().conflicts, 0).key).toBe('k54');
    await queue.clearConflicts();
    expect(queue.getSnapshot().conflicts).toEqual([]);
  });
});

describe('failures + retry', () => {
  test('network failure → attempts++, lastError, retried with backoff until it works', async () => {
    jest.useFakeTimers();
    const server = fakeRemote();
    queue.setRemote(server.remote);
    queue.enqueue(fact('a', '1', 1));
    server.failWith(new ProviderError('mark55', 'network', 'เชื่อมต่อ Mark 55 ไม่ได้'));

    const res = await queue.flush();
    expect(res).toMatchObject({ ok: false, pending: 1, error: 'เชื่อมต่อ Mark 55 ไม่ได้' });
    expect(queue.getSnapshot().lastError).toMatchObject({ kind: 'network' });
    expect(nth(queue.getSnapshot().queue, 0).attempts).toBe(1);

    await jest.advanceTimersByTimeAsync(RETRY_BASE_MS); // ครั้งที่ 2 ล้ม
    expect(server.pulls).toHaveLength(2);
    expect(nth(queue.getSnapshot().queue, 0).attempts).toBe(2);

    server.failWith(null);
    await jest.advanceTimersByTimeAsync(RETRY_BASE_MS * 2 - 1);
    expect(server.pulls).toHaveLength(2); // backoff doubled
    await jest.advanceTimersByTimeAsync(1);
    expect(server.pulls).toHaveLength(3);
    expect(queue.getSnapshot()).toMatchObject({ queue: [], lastError: null });
  });

  test('backoff is capped at 5 minutes', () => {
    expect(SyncQueue.retryDelay(1)).toBe(RETRY_BASE_MS);
    expect(SyncQueue.retryDelay(3)).toBe(RETRY_BASE_MS * 4);
    expect(SyncQueue.retryDelay(50)).toBe(RETRY_MAX_MS);
  });

  test('401 (pairing expired) is not retried', async () => {
    jest.useFakeTimers();
    const server = fakeRemote();
    queue.setRemote(server.remote);
    server.failWith(new ProviderError('mark55', 'auth', 'การจับคู่หมดอายุ'));
    await queue.flush();
    await jest.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(server.pulls).toHaveLength(1);
    expect(queue.getSnapshot().lastError).toMatchObject({ kind: 'auth' });
  });

  test('an unexpected error is logged and reported as unknown', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    server.failWith(new Error('boom'));
    await expect(queue.flush()).resolves.toMatchObject({ ok: false, error: 'boom' });
    expect(errorSpy).toHaveBeenCalledWith('[sync] ซิงก์ไม่สำเร็จ', expect.any(Error));
  });
});

describe('triggers', () => {
  test('foreground and back-online trigger a flush', async () => {
    const server = fakeRemote();
    queue.setRemote(server.remote);
    triggers.fire.foreground?.();
    await settle();
    triggers.fire.online?.();
    await settle();
    expect(server.pulls).toHaveLength(2);
  });

  test('auto-sync every 30s only while enabled and paired', async () => {
    jest.useFakeTimers();
    const server = fakeRemote();
    queue.setRemote(server.remote);
    await jest.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS);
    expect(server.pulls).toHaveLength(0);

    await queue.setAutoSync(true);
    await jest.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS * 2);
    expect(server.pulls).toHaveLength(2);

    await queue.setAutoSync(false);
    await jest.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS * 2);
    expect(server.pulls).toHaveLength(2);

    await queue.setAutoSync(true);
    queue.setRemote(null);
    await jest.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS * 2);
    expect(server.pulls).toHaveLength(2);
  });
});

describe('MemorySync (pairing + connection)', () => {
  const setup = () => {
    const server = fakeRemote();
    const remote = remoteStub(server.remote);
    const createRemote = jest.fn(() => remote);
    const keys = fakeSecureStore();
    const sync = new MemorySync({ queue, secure: keys, createRemote, deviceName: 'Test phone', now: () => clock });
    return { server, remote, createRemote, keys, sync };
  };

  test('pair → token in SecureStore, existing facts pushed; unpair → forgotten', async () => {
    const { server, remote, keys, sync, createRemote } = setup();
    await memory.save(GLOBAL, 'before', 'มีอยู่ก่อนจับคู่');
    await sync.start();
    expect(await sync.setServerUrl('192.168.1.10:8787')).toBeNull();
    expect(await AsyncStorage.getItem('mark55.sync.serverUrl')).toBe('http://192.168.1.10:8787');

    const device = await sync.pair('123456');
    expect(remote.pair).toHaveBeenCalledWith('123456', 'Test phone');
    expect(createRemote).toHaveBeenLastCalledWith({ baseUrl: 'http://192.168.1.10:8787' });
    expect(device).toEqual({ deviceName: 'Test phone', expiresAt: 2_000_000, pairedAt: clock });
    expect(keys.store.get(MARK55_TOKEN_KEY)).toBe('jwt');
    expect(await AsyncStorage.getItem('jwt')).toBeNull();
    expect(sync.isPaired).toBe(true);
    await settle();
    expect(nth(server.pushes, 0).facts.map((f) => f.key)).toEqual(['before']);
    expect(await sync.setServerUrl('http://10.0.0.1:8787')).toContain('ยกเลิกการจับคู่ก่อน');

    await sync.unpair();
    expect(keys.store.has(MARK55_TOKEN_KEY)).toBe(false);
    expect(sync.getSnapshot().device).toBeNull();
    expect(queue.getSnapshot()).toMatchObject({ paired: false, queue: [], lastSyncAt: 0 });
    expect(await memory.load(GLOBAL, 'before')).not.toBeNull(); // local facts stay
  });

  test('start() with a saved token resumes syncing', async () => {
    const { server, keys, sync, createRemote } = setup();
    keys.store.set(MARK55_TOKEN_KEY, 'saved-jwt');
    await AsyncStorage.setItem('mark55.sync.serverUrl', 'http://192.168.1.10:8787');
    await sync.start();
    expect(createRemote).toHaveBeenCalledWith({ baseUrl: 'http://192.168.1.10:8787', token: 'saved-jwt' });
    expect(sync.isPaired).toBe(true);
    await settle();
    expect(server.pulls).toHaveLength(1);
  });

  test('a failing SecureStore at pairing → not paired, token not stored anywhere else', async () => {
    const { keys, sync } = setup();
    await sync.setServerUrl('http://192.168.1.10:8787');
    keys.setItemAsync.mockRejectedValueOnce(new Error('keystore'));
    await expect(sync.pair('123456')).rejects.toThrow('ที่ปลอดภัย');
    expect(sync.isPaired).toBe(false);
  });

  test('testConnection: health only when unpaired; health + verify when paired', async () => {
    const { remote, sync } = setup();
    await expect(sync.testConnection()).resolves.toMatchObject({ ok: false, message: 'ใส่ Server URL ก่อน' });
    await sync.setServerUrl('http://192.168.1.10:8787');
    await expect(sync.testConnection()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('จับคู่ต่อได้เลย') });
    expect(remote.verify).not.toHaveBeenCalled();

    await sync.pair('123456');
    await expect(sync.testConnection()).resolves.toMatchObject({ ok: true, message: 'เชื่อมต่อแล้ว · Mark 55 v0.1.0' });
    remote.verify.mockResolvedValueOnce({ valid: false, deviceName: null, expiresAt: null });
    await expect(sync.testConnection()).resolves.toMatchObject({ ok: false, message: expect.stringContaining('หมดอายุ') });
    remote.health.mockRejectedValueOnce(new ProviderError('mark55', 'network', 'เชื่อมต่อ Mark 55 ไม่ได้'));
    await expect(sync.testConnection()).resolves.toMatchObject({ ok: false, message: 'เชื่อมต่อ Mark 55 ไม่ได้' });
    expect(sync.getSnapshot().lastCheck).toMatchObject({ ok: false });
  });

  test('invalid server URL is rejected with a Thai message', async () => {
    const { sync } = setup();
    expect(await sync.setServerUrl('http://8.8.8.8')).toContain('https://');
  });
});
