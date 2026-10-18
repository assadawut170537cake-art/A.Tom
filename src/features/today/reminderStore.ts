/**
 * @file การเตือนความจำ — AsyncStorage `atom.reminders.v1` + แจ้งเตือนของเครื่อง (ผ่าน {@link ReminderScheduler})
 *
 * ตั้งเตือน = จดลงที่เก็บ + ตั้ง notification ของ OS (ปิดแอปแล้วก็ยังเด้ง) · ลบ = ยกเลิก notification ด้วย
 * ตั้ง notification ไม่ได้ (ไม่ได้สิทธิ์) → throw ข้อความไทย และไม่จดลงที่เก็บ (กันบอสคิดว่าตั้งแล้ว)
 */

import { readJSON, writeJSON } from '../../core/storage/jsonStorage';
import { isNumber, isRecord, isString } from '../../core/types/guards';

export const REMINDERS_STORAGE_KEY = 'atom.reminders.v1';
export const MAX_REMINDER_LENGTH = 200;
/** เลยเวลาแล้วเกินนี้ → ลบทิ้งตอนโหลด (หน้า Today ยังโชว์ที่เพิ่งเลยวันนี้) */
const KEEP_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 200;

export interface Reminder {
  id: string;
  text: string;
  /** epoch ms ที่จะเตือน */
  at: number;
  /** id ของ notification ในเครื่อง (null = ตั้งไม่สำเร็จ / ไม่มี scheduler) */
  notificationId: string | null;
  createdAt: number;
}

export interface ReminderScheduler {
  /** คืน id ของ notification · throw (ข้อความไทย) เมื่อไม่ได้สิทธิ์ */
  schedule(reminder: Pick<Reminder, 'id' | 'text' | 'at'>): Promise<string>;
  cancel(notificationId: string): Promise<void>;
}

const isReminder = (v: unknown): v is Reminder =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.text) &&
  isNumber(v.at) &&
  isNumber(v.createdAt) &&
  (v.notificationId === null || isString(v.notificationId));
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

type Listener = (reminders: readonly Reminder[]) => void;

export class ReminderStore {
  private reminders: Reminder[] | null = null;
  private readonly listeners = new Set<Listener>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly scheduler: ReminderScheduler | null,
    private readonly key: string = REMINDERS_STORAGE_KEY,
    private readonly now: () => number = Date.now
  ) {}

  /** เรียงตามเวลาเตือน (ใกล้สุดก่อน) */
  async list(): Promise<readonly Reminder[]> {
    if (!this.reminders) {
      const raw = (await readJSON(this.key, isList)) ?? [];
      const cutoff = this.now() - KEEP_PAST_MS;
      this.reminders ??= raw.filter(isReminder).filter((r) => r.at >= cutoff).sort((a, b) => a.at - b.at);
    }
    return this.reminders;
  }

  async upcoming(): Promise<readonly Reminder[]> {
    const now = this.now();
    return (await this.list()).filter((r) => r.at > now);
  }

  /** throw (ข้อความไทย) เมื่อข้อความว่าง/ยาวเกิน, เวลาผ่านไปแล้ว, หรือตั้งแจ้งเตือนไม่ได้ */
  async add(text: string, at: number): Promise<Reminder> {
    const clean = text.trim() || 'ถึงเวลาที่บอสตั้งไว้แล้วครับ';
    if (clean.length > MAX_REMINDER_LENGTH) {
      throw new Error(`ข้อความเตือนยาวเกิน ${MAX_REMINDER_LENGTH} ตัวอักษร — ช่วยย่อให้สั้นลงหน่อยครับ`);
    }
    const now = this.now();
    if (at <= now) throw new Error('เวลานั้นผ่านไปแล้วครับ — บอกเวลาที่ยังมาไม่ถึง');
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const notificationId = this.scheduler ? await this.scheduler.schedule({ id, text: clean, at }) : null;
    const reminder: Reminder = { id, text: clean, at, notificationId, createdAt: now };
    const next = [...(await this.list()), reminder].sort((a, b) => a.at - b.at).slice(-MAX_REMINDERS);
    await this.save(next);
    return reminder;
  }

  async remove(id: string): Promise<void> {
    const current = await this.list();
    const target = current.find((r) => r.id === id);
    if (!target) return;
    if (target.notificationId && this.scheduler) {
      // ยกเลิกไม่ได้ (เด้งไปแล้ว/ถูกลบจากระบบ) ก็ลบจากรายการต่อ
      await this.scheduler.cancel(target.notificationId).catch((e: unknown) => {
        console.error('[reminders] ยกเลิกการแจ้งเตือนไม่ได้', e);
      });
    }
    await this.save(current.filter((r) => r.id !== id));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private save(next: Reminder[]): Promise<void> {
    this.reminders = next;
    for (const listener of this.listeners) listener(next);
    const run = this.writeChain.then(() => writeJSON(this.key, next));
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}
