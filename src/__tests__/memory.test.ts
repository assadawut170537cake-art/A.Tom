import AsyncStorage from '@react-native-async-storage/async-storage';

import { LocalMemoryAdapter, MEMORY_KEY_PREFIX } from '../core/memory/LocalMemoryAdapter';
import type { MemoryFact, MemoryTarget } from '../core/memory/types';

const GLOBAL: MemoryTarget = { scope: 'global' };
const ATOM: MemoryTarget = { scope: 'persona', persona: 1 };
const JARVIS: MemoryTarget = { scope: 'persona', persona: 2 };

let memory: LocalMemoryAdapter;
let errorSpy: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  memory = new LocalMemoryAdapter();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const stored = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') as MemoryFact | null;

describe('LocalMemoryAdapter — CRUD', () => {
  test('save → stored under atom.memory.v1.<scope>.<key> with metadata', async () => {
    const fact = await memory.save(GLOBAL, 'nickname', 'ต้น');
    expect(fact).toEqual({
      id: expect.stringMatching(/^mem-/),
      key: 'nickname',
      value: 'ต้น',
      source: 'user',
      createdAt: expect.any(Number),
      updatedAt: fact.createdAt,
    });
    expect(await stored('atom.memory.v1.global.nickname')).toEqual(fact);
    await memory.save(ATOM, 'joke', 'มุก 2499', 'assistant');
    expect((await stored('atom.memory.v1.persona.1.joke'))?.source).toBe('assistant');
  });

  test('load returns the fact, or null when missing', async () => {
    await memory.save(GLOBAL, 'city', 'เชียงใหม่');
    await expect(memory.load(GLOBAL, 'city')).resolves.toMatchObject({ value: 'เชียงใหม่' });
    await expect(memory.load(GLOBAL, 'nope')).resolves.toBeNull();
  });

  test('saving an existing key updates value + updatedAt but keeps id and createdAt', async () => {
    const first = await memory.save(GLOBAL, 'coffee', 'ลาเต้');
    jest.spyOn(Date, 'now').mockReturnValue(first.createdAt + 5_000);
    const second = await memory.save(GLOBAL, 'coffee', 'อเมริกาโน่', 'module:pc-bridge');
    expect(second).toEqual({ ...first, value: 'อเมริกาโน่', source: 'module:pc-bridge', updatedAt: first.createdAt + 5_000 });
  });

  test('remove deletes one fact and reports whether it existed', async () => {
    await memory.save(GLOBAL, 'a', '1');
    await expect(memory.remove(GLOBAL, 'a')).resolves.toBe(true);
    await expect(memory.remove(GLOBAL, 'a')).resolves.toBe(false);
    await expect(memory.load(GLOBAL, 'a')).resolves.toBeNull();
    expect(await AsyncStorage.getItem('atom.memory.v1.global.a')).toBeNull();
  });

  test('a fact written by a previous app run is readable by a fresh instance', async () => {
    await memory.save(JARVIS, 'tone', 'สุภาพ');
    await expect(new LocalMemoryAdapter().load(JARVIS, 'tone')).resolves.toMatchObject({ value: 'สุภาพ' });
  });
});

describe('LocalMemoryAdapter — scopes', () => {
  test('list returns only the target scope, oldest first; personas never see each other', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(300).mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValue(400);
    await memory.save(GLOBAL, 'late', '3');
    await memory.save(GLOBAL, 'early', '1');
    await memory.save(ATOM, 'mine', 'อะตอม');
    await memory.save(JARVIS, 'mine', 'จาร์วิส');
    expect((await memory.list(GLOBAL)).map((f) => f.key)).toEqual(['early', 'late']);
    expect((await memory.list(ATOM)).map((f) => f.value)).toEqual(['อะตอม']);
    expect((await memory.list(JARVIS)).map((f) => f.value)).toEqual(['จาร์วิส']);
  });

  test('clear empties one scope only', async () => {
    await memory.save(GLOBAL, 'g', '1');
    await memory.save(ATOM, 'p1', '1');
    await memory.save(ATOM, 'p2', '2');
    await memory.clear(ATOM);
    await expect(memory.list(ATOM)).resolves.toEqual([]);
    expect(await memory.list(GLOBAL)).toHaveLength(1);
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(MEMORY_KEY_PREFIX))).toEqual([
      'atom.memory.v1.global.g',
    ]);
  });

  test('concurrent saves land in order without losing any', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => memory.save(GLOBAL, `k${i}`, `v${i}`)));
    expect(await memory.list(GLOBAL)).toHaveLength(20);
    await Promise.all([memory.save(GLOBAL, 'same', 'a'), memory.save(GLOBAL, 'same', 'b')]);
    await expect(memory.load(GLOBAL, 'same')).resolves.toMatchObject({ value: 'b' });
  });

  test('sync is a local no-op', async () => {
    await expect(memory.sync()).resolves.toEqual({ pushed: 0, pulled: 0, pending: 0 });
  });
});

describe('LocalMemoryAdapter — errors and fallback', () => {
  test.each(['', 'has.dot', 'มีภาษาไทย', 'x'.repeat(65), 'space key'])('invalid key %p is rejected', async (key) => {
    await expect(memory.save(GLOBAL, key, 'v')).rejects.toThrow('[memory] key ไม่ถูกต้อง');
  });

  test('write failure → kept in memory, isPersistent=false, console.error, no throw', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('QuotaExceeded'));
    await expect(memory.save(GLOBAL, 'name', 'บอส')).resolves.toMatchObject({ value: 'บอส' });
    expect(memory.isPersistent()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[memory] บันทึกไม่สำเร็จ'), expect.any(Error));
    await expect(memory.load(GLOBAL, 'name')).resolves.toMatchObject({ value: 'บอส' });
    expect((await memory.list(GLOBAL)).map((f) => f.key)).toEqual(['name']);

    await memory.save(GLOBAL, 'other', 'x'); // storage works again
    expect(memory.isPersistent()).toBe(true);
    await expect(memory.load(GLOBAL, 'name')).resolves.toMatchObject({ value: 'บอส' });
  });

  test('read failure → served from the memory mirror', async () => {
    await memory.save(GLOBAL, 'pet', 'แมว');
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('I/O'));
    await expect(memory.load(GLOBAL, 'pet')).resolves.toMatchObject({ value: 'แมว' });
    expect(memory.isPersistent()).toBe(false);
  });

  test('list failure → memory mirror, never throws', async () => {
    await memory.save(ATOM, 'a', '1');
    jest.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(new Error('locked'));
    await expect(memory.list(ATOM)).resolves.toEqual([expect.objectContaining({ key: 'a' })]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('อ่านรายการความจำไม่สำเร็จ'), expect.any(Error));
  });

  test('remove / clear failures are logged, not thrown', async () => {
    await memory.save(GLOBAL, 'a', '1');
    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('x'));
    await expect(memory.remove(GLOBAL, 'a')).resolves.toBe(true);
    jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error('x'));
    await memory.save(GLOBAL, 'b', '2');
    await expect(memory.clear(GLOBAL)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  test('corrupt entries are dropped with console.error', async () => {
    await AsyncStorage.setItem('atom.memory.v1.global.broken', '{not json');
    await AsyncStorage.setItem('atom.memory.v1.global.wrong', JSON.stringify({ key: 'wrong', value: 1 }));
    await memory.save(GLOBAL, 'ok', 'fine');
    expect((await memory.list(GLOBAL)).map((f) => f.key)).toEqual(['ok']);
    await expect(memory.load(GLOBAL, 'broken')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[memory] atom.memory.v1.global.broken: ข้อมูลเสีย — ตัดทิ้ง');
  });
});

describe('LocalMemoryAdapter — change feed for SyncQueue', () => {
  test('save / remove / clear notify subscribers (remove + clear as tombstones)', async () => {
    const changes: unknown[] = [];
    const stop = memory.subscribe((c) => changes.push(c));
    const fact = await memory.save(GLOBAL, 'a', '1');
    await memory.save(ATOM, 'b', '2');
    await memory.remove(GLOBAL, 'a');
    await memory.remove(GLOBAL, 'missing'); // nothing removed → no event
    await memory.clear(ATOM);
    stop();
    await memory.save(GLOBAL, 'c', '3'); // after unsubscribe → not seen
    expect(changes).toEqual([
      { target: GLOBAL, key: 'a', value: '1', updatedAt: fact.updatedAt, deleted: false },
      { target: ATOM, key: 'b', value: '2', updatedAt: expect.any(Number), deleted: false },
      { target: GLOBAL, key: 'a', value: '', updatedAt: expect.any(Number), deleted: true },
      { target: ATOM, key: 'b', value: '', updatedAt: expect.any(Number), deleted: true },
    ]);
  });

  test('a throwing listener is logged and does not break the save', async () => {
    memory.subscribe(() => {
      throw new Error('boom');
    });
    await expect(memory.save(GLOBAL, 'a', '1')).resolves.toMatchObject({ value: '1' });
    expect(errorSpy).toHaveBeenCalledWith('[memory] listener ล้ม', expect.any(Error));
  });

  test('applyRemote keeps the server updatedAt, keeps id/createdAt, and does not notify', async () => {
    const listener = jest.fn();
    const original = await memory.save(JARVIS, 'k', 'old', 'assistant');
    memory.subscribe(listener);
    await memory.applyRemote({ target: JARVIS, key: 'k', value: 'new', updatedAt: 42, deleted: false });
    expect(await memory.load(JARVIS, 'k')).toEqual({ ...original, value: 'new', updatedAt: 42 });
    await memory.applyRemote({ target: GLOBAL, key: 'fresh', value: 'v', updatedAt: 7, deleted: false });
    expect(await memory.load(GLOBAL, 'fresh')).toMatchObject({ source: 'user', createdAt: 7, updatedAt: 7 });
    await memory.applyRemote({ target: JARVIS, key: 'k', value: '', updatedAt: 50, deleted: true });
    expect(await memory.load(JARVIS, 'k')).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});
