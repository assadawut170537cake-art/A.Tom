/**
 * @file ChatSync — คิว offline-first ของ "ห้องแชทเดียวกัน": ส่งข้อความใหม่ขึ้น Mark 55 + ดึงของเครื่องอื่นมา merge
 *
 * append-only จึงไม่มี conflict: push ข้อความที่ยังไม่ได้ส่ง · pull ทุกข้อความหลัง cursor แล้วเรียก `apply()` ให้แอป merge
 * ไม่จับคู่ (`setRemote(null)`) = ไม่มี timer ไม่ทำอะไร → แชทเครื่องเดียวทำงานเหมือนเดิมทุกอย่าง
 *
 * ที่เก็บ (AsyncStorage): `atom.chat.sync.queue` (ข้อความรอส่ง) · `atom.chat.sync.cursor` (serverTimestamp รอบล่าสุด)
 * - core ไม่รู้จัก store → แอปส่ง `apply(messages)` (เขียนเข้า useAtomStore) และ `enqueue()` ตอนมีข้อความใหม่
 * - การ merge ฝั่งแอปต้อง **ไม่** enqueue กลับ (กันส่งวน) เหมือน `applyRemote` ของ memory
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isArray } from '../types/guards';
import { parseSyncMessage, type SyncMessage } from './chatSyncTypes';
import type { ChatRemote } from './RemoteChatAdapter';

export const CHAT_QUEUE_KEY = 'atom.chat.sync.queue';
export const CHAT_CURSOR_KEY = 'atom.chat.sync.cursor';

/** ดึง/ส่งทุกเท่านี้เมื่อจับคู่แล้ว */
export const CHAT_POLL_MS = 20_000;
/** คิวยาวสุด (ออฟไลน์นาน ๆ) — เกินนี้ตัดตัวเก่าทิ้ง (ข้อความเก่าสุดมักซิงก์ไปแล้ว) */
export const MAX_QUEUE = 1_000;
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

type KeyValueStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ChatSyncTimers {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const REAL_TIMERS: ChatSyncTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface ChatSyncDeps {
  /** merge ข้อความจากเครื่องอื่นเข้าแอป (ต้องไม่ enqueue กลับ) */
  apply(messages: SyncMessage[]): void | Promise<void>;
  storage?: KeyValueStorage | undefined;
  timers?: ChatSyncTimers | undefined;
  pollMs?: number | undefined;
}

export interface ChatSyncSnapshot {
  paired: boolean;
  pending: number;
  /** serverTimestamp ของ pull ล่าสุด */
  cursor: number;
}

export class ChatSync {
  private readonly apply: ChatSyncDeps['apply'];
  private readonly storage: KeyValueStorage;
  private readonly timers: ChatSyncTimers;
  private readonly pollMs: number;

  private queue: SyncMessage[] = [];
  private cursor = 0;
  private remote: ChatRemote | null = null;
  private timer: unknown = null;
  private syncing = false;
  private restored: Promise<void> | null = null;
  /** ไม่ sync จนกว่าถึงเวลานี้ (backoff หลังล้ม) */
  private nextAttemptAt = 0;
  private backoffMs = BACKOFF_START_MS;

  constructor(deps: ChatSyncDeps) {
    this.apply = deps.apply;
    this.storage = deps.storage ?? AsyncStorage;
    this.timers = deps.timers ?? REAL_TIMERS;
    this.pollMs = deps.pollMs ?? CHAT_POLL_MS;
  }

  getSnapshot = (): ChatSyncSnapshot => ({
    paired: this.remote !== null,
    pending: this.queue.length,
    cursor: this.cursor,
  });

  /** โหลดคิว + cursor ที่ค้างไว้ (เรียกครั้งเดียว) */
  restore(): Promise<void> {
    return (this.restored ??= this.doRestore());
  }

  private async doRestore(): Promise<void> {
    try {
      const [queueRaw, cursorRaw] = await Promise.all([
        this.storage.getItem(CHAT_QUEUE_KEY),
        this.storage.getItem(CHAT_CURSOR_KEY),
      ]);
      if (queueRaw) {
        const parsed: unknown = JSON.parse(queueRaw);
        if (isArray(parsed)) this.queue = parsed.flatMap((m) => parseSyncMessage(m) ?? []);
      }
      const cursor = Number(cursorRaw);
      if (Number.isFinite(cursor) && cursor > 0) this.cursor = cursor;
    } catch (e) {
      console.error('[chat-sync] โหลดคิวแชทที่ค้างไว้ไม่ได้ — เริ่มใหม่', e);
    }
  }

  /** ตั้ง/ล้างปลายทาง · null = ยกเลิกจับคู่ (หยุด timer) · ตั้ง = เริ่ม poll */
  setRemote(remote: ChatRemote | null): void {
    this.remote = remote;
    if (remote) this.ensureTimer();
    else this.stop();
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = this.timers.setInterval(() => void this.syncNow(), this.pollMs);
  }

  stop(): void {
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** ต่อท้ายคิว (ข้าม id ซ้ำ) แล้วลองส่งทันที */
  async enqueue(messages: SyncMessage[]): Promise<void> {
    await this.restore();
    const have = new Set(this.queue.map((m) => m.id));
    const add = messages.filter((m) => !have.has(m.id) && have.add(m.id));
    if (!add.length) return;
    this.queue.push(...add);
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);
    await this.persistQueue();
    void this.syncNow();
  }

  /** ส่ง + ดึง 1 รอบ (กันทับซ้อน + backoff หลังล้ม) */
  async syncNow(): Promise<void> {
    if (!this.remote || this.syncing) return;
    if (this.timers.now() < this.nextAttemptAt) return;
    this.syncing = true;
    try {
      await this.restore();
      await this.flush();
      await this.pullOnce();
      this.backoffMs = BACKOFF_START_MS;
      this.nextAttemptAt = 0;
    } catch (e) {
      // ออฟไลน์/ล่ม → เลื่อนรอบถัดไป (exponential) ไม่ทิ้งคิว
      this.nextAttemptAt = this.timers.now() + this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
      console.error('[chat-sync] ซิงก์แชทไม่สำเร็จ — จะลองใหม่', e);
    } finally {
      this.syncing = false;
    }
  }

  private async flush(): Promise<void> {
    if (!this.remote || !this.queue.length) return;
    const batch = this.queue.slice();
    await this.remote.push(batch);
    // ส่งสำเร็จ → เอาที่ส่งแล้วออก (ของใหม่ที่ enqueue ระหว่างส่งยังอยู่)
    const sent = new Set(batch.map((m) => m.id));
    this.queue = this.queue.filter((m) => !sent.has(m.id));
    await this.persistQueue();
  }

  private async pullOnce(): Promise<void> {
    if (!this.remote) return;
    const { messages, serverTimestamp } = await this.remote.pull(this.cursor);
    if (messages.length) await this.apply(messages);
    if (serverTimestamp > this.cursor) {
      this.cursor = serverTimestamp;
      await this.persistCursor();
    }
  }

  private async persistQueue(): Promise<void> {
    try {
      await this.storage.setItem(CHAT_QUEUE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error(
        '[chat-sync] บันทึกคิวแชทไม่สำเร็จ — ยังส่งได้รอบนี้ แต่เปิดแอปใหม่อาจส่งซ้ำ/ตก',
        e,
      );
    }
  }

  private async persistCursor(): Promise<void> {
    try {
      await this.storage.setItem(CHAT_CURSOR_KEY, String(this.cursor));
    } catch (e) {
      console.error('[chat-sync] บันทึกตำแหน่งซิงก์แชทไม่สำเร็จ — อาจดึงข้อความซ้ำรอบหน้า', e);
    }
  }

  /** ล้างทุกอย่าง (ตอน unpair) — ข้อความในเครื่องไม่ถูกลบ */
  async reset(): Promise<void> {
    this.stop();
    this.remote = null;
    this.queue = [];
    this.cursor = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextAttemptAt = 0;
    try {
      await Promise.all([
        this.storage.removeItem(CHAT_QUEUE_KEY),
        this.storage.removeItem(CHAT_CURSOR_KEY),
      ]);
    } catch (e) {
      console.error('[chat-sync] ล้างคิวแชทไม่สำเร็จ', e);
    }
  }
}
