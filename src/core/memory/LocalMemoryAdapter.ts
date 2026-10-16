/**
 * @file Shared Memory บนเครื่อง (AsyncStorage) — ใช้งานได้แล้วใน Phase 4
 *
 * - หนึ่ง fact = หนึ่ง key: `atom.memory.v1.<scope>.<key>` โดย scope = `global` หรือ `persona.<1-4>`
 * - เขียนทีละรายการผ่านคิวเดียว → save/remove ที่ยิงพร้อมกันไม่ทับกัน
 * - **ไม่ทำให้แอป crash:** storage อ่าน/เขียนไม่ได้ → ใช้ข้อมูลในหน่วยความจำต่อ, `isPersistent()` = false,
 *   และ `console.error` · ข้อมูลเสีย → ตัดทิ้งพร้อม `console.error`
 * - `sync()` เป็น no-op — การ sync กับ Mark 55 ทำผ่าน SyncQueue ซึ่ง `subscribe()` ฟังการเปลี่ยนแปลงจากที่นี่
 *   แล้วเขียนของที่ดึงจาก server กลับด้วย `applyRemote()` (ไม่แจ้ง listener → ไม่ส่งกลับขึ้น server ซ้ำ)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isNumber, isRecord, isString, parseJSON } from '../types/guards';
import {
  MEMORY_KEY_PATTERN,
  scopeSegment,
  type MemoryFact,
  type MemorySource,
  type MemoryStore,
  type MemoryTarget,
  type SyncFact,
  type SyncResult,
} from './types';

/** แจ้งเมื่อ fact ถูกเพิ่ม/แก้/ลบในเครื่อง (ลบ = `deleted: true`) */
export type MemoryChangeListener = (change: SyncFact) => void;

export const MEMORY_KEY_PREFIX = 'atom.memory.v1.';

const isSource = (v: unknown): v is MemorySource =>
  v === 'user' || v === 'assistant' || v === 'system' || (isString(v) && v.startsWith('module:'));

function isFact(v: unknown): v is MemoryFact {
  return (
    isRecord(v) &&
    isString(v.id) &&
    isString(v.key) &&
    isString(v.value) &&
    isSource(v.source) &&
    isNumber(v.createdAt) &&
    isNumber(v.updatedAt)
  );
}

let idCounter = 0;
const createId = () => `mem-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export class LocalMemoryAdapter implements MemoryStore {
  /** Memory mirror of every fact this instance has seen; the fallback when storage fails. */
  private readonly mirror = new Map<string, MemoryFact>();
  private writeChain: Promise<unknown> = Promise.resolve();
  private persistent = true;
  private readonly listeners = new Set<MemoryChangeListener>();

  constructor(private readonly prefix: string = MEMORY_KEY_PREFIX) {}

  /** False after a storage failure: facts still work, but only until the app restarts. */
  isPersistent(): boolean {
    return this.persistent;
  }

  async save(
    target: MemoryTarget,
    key: string,
    value: string,
    source: MemorySource = 'user'
  ): Promise<MemoryFact> {
    const storageKey = this.storageKey(target, key);
    return this.enqueue(async () => {
      const existing = await this.read(storageKey);
      const now = Date.now();
      const fact: MemoryFact = {
        id: existing?.id ?? createId(),
        key,
        value,
        source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.mirror.set(storageKey, fact);
      await this.attempt('บันทึก', () => AsyncStorage.setItem(storageKey, JSON.stringify(fact)));
      this.emit({ target, key, value, updatedAt: now, deleted: false });
      return fact;
    });
  }

  async load(target: MemoryTarget, key: string): Promise<MemoryFact | null> {
    const storageKey = this.storageKey(target, key);
    await this.writeChain; // read-your-writes
    return this.read(storageKey);
  }

  async list(target: MemoryTarget): Promise<MemoryFact[]> {
    await this.writeChain;
    const prefix = this.scopePrefix(target);
    const facts = new Map<string, MemoryFact>();
    for (const [k, fact] of this.mirror) if (k.startsWith(prefix)) facts.set(k, fact);
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
      for (const [k, raw] of await AsyncStorage.multiGet(keys)) {
        const fact = this.parse(k, raw);
        if (fact) {
          facts.set(k, fact);
          this.mirror.set(k, fact);
        } else {
          facts.delete(k); // corrupt in storage → dropped (parse() logged it)
          this.mirror.delete(k);
        }
      }
    } catch (e) {
      this.fail('อ่านรายการความจำ', e);
    }
    return [...facts.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async remove(target: MemoryTarget, key: string): Promise<boolean> {
    const storageKey = this.storageKey(target, key);
    return this.enqueue(async () => {
      const existed = (await this.read(storageKey)) !== null;
      this.mirror.delete(storageKey);
      await this.attempt('ลบ', () => AsyncStorage.removeItem(storageKey));
      if (existed) this.emit({ target, key, value: '', updatedAt: Date.now(), deleted: true });
      return existed;
    });
  }

  async clear(target: MemoryTarget): Promise<void> {
    const prefix = this.scopePrefix(target);
    return this.enqueue(async () => {
      // จด key ที่หายไปทั้งหมด (ทั้งใน mirror และ storage) เพื่อแจ้ง listener เป็น tombstone ทีละตัว
      const removed = new Set<string>();
      for (const k of [...this.mirror.keys()]) {
        if (!k.startsWith(prefix)) continue;
        this.mirror.delete(k);
        removed.add(k);
      }
      await this.attempt('ล้าง', async () => {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
        for (const k of keys) removed.add(k);
        if (keys.length) await AsyncStorage.multiRemove(keys);
      });
      const now = Date.now();
      for (const k of removed) this.emit({ target, key: k.slice(prefix.length), value: '', updatedAt: now, deleted: true });
    });
  }

  /** Local-only: nothing to reconcile here — Mark 55 sync goes through SyncQueue. */
  async sync(): Promise<SyncResult> {
    return { pushed: 0, pulled: 0, pending: 0 };
  }

  /** ฟังการเปลี่ยนแปลงจาก save/remove/clear (ไม่รวม applyRemote) — คืนฟังก์ชันเลิกฟัง */
  subscribe(listener: MemoryChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * เขียน fact ที่ได้จาก server ตามที่ server บอก (คง `updatedAt` ของ server ไว้ ไม่ใช้เวลาเครื่อง)
   * และ**ไม่แจ้ง listener** — ไม่งั้น SyncQueue จะส่งของที่เพิ่งดึงมากลับขึ้นไปอีกรอบ
   */
  async applyRemote(change: SyncFact): Promise<void> {
    const storageKey = this.storageKey(change.target, change.key);
    return this.enqueue(async () => {
      if (change.deleted) {
        this.mirror.delete(storageKey);
        await this.attempt('ลบ', () => AsyncStorage.removeItem(storageKey));
        return;
      }
      const existing = await this.read(storageKey);
      const fact: MemoryFact = {
        id: existing?.id ?? createId(),
        key: change.key,
        value: change.value,
        source: existing?.source ?? 'user',
        createdAt: existing?.createdAt ?? change.updatedAt,
        updatedAt: change.updatedAt,
      };
      this.mirror.set(storageKey, fact);
      await this.attempt('บันทึก', () => AsyncStorage.setItem(storageKey, JSON.stringify(fact)));
    });
  }

  // ---- internals ------------------------------------------------------------------------------

  private storageKey(target: MemoryTarget, key: string): string {
    if (!MEMORY_KEY_PATTERN.test(key)) {
      throw new Error(`[memory] key ไม่ถูกต้อง: "${key}" (ใช้ได้เฉพาะ A-Z a-z 0-9 _ - ไม่เกิน 64 ตัว)`);
    }
    return `${this.scopePrefix(target)}${key}`;
  }

  private scopePrefix(target: MemoryTarget): string {
    return `${this.prefix}${scopeSegment(target)}.`;
  }

  /** Storage first (it may hold facts written before this run), memory mirror as the fallback. */
  private async read(storageKey: string): Promise<MemoryFact | null> {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      // Not in storage: either never saved, or its write failed and only the mirror has it
      if (raw == null) return this.mirror.get(storageKey) ?? null;
      const fact = this.parse(storageKey, raw);
      if (fact) this.mirror.set(storageKey, fact);
      return fact;
    } catch (e) {
      this.fail('อ่านความจำ', e);
      return this.mirror.get(storageKey) ?? null;
    }
  }

  private parse(storageKey: string, raw: string | null): MemoryFact | null {
    if (raw == null) return null;
    const fact = parseJSON(raw, isFact);
    if (!fact) console.error(`[memory] ${storageKey}: ข้อมูลเสีย — ตัดทิ้ง`);
    return fact;
  }

  private async attempt(action: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
      this.persistent = true;
    } catch (e) {
      this.fail(action, e);
    }
  }

  /** listener ที่ throw ไม่ทำให้การบันทึกล้ม */
  private emit(change: SyncFact): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (e) {
        console.error('[memory] listener ล้ม', e);
      }
    }
  }

  private fail(action: string, e: unknown): void {
    this.persistent = false;
    console.error(`[memory] ${action}ไม่สำเร็จ — ใช้ความจำในหน่วยความจำชั่วคราว`, e);
  }

  /** Serialise mutations; one failure never blocks the next (attempt() never rejects). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

/** App-wide instance — ChatHandler ของแอปใช้ตัวนี้ (ประกอบใน features/router/appRouter.ts) */
export const localMemory = new LocalMemoryAdapter();
