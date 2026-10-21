/**
 * @file SnapshotStore — ถ่ายสำเนาค่าของ key ชุดหนึ่งใน AsyncStorage ไว้ย้อนกลับ (CONCEPT ข้อ 4)
 *
 * ใช้ตอน "จะแก้การตั้งค่า/ข้อมูล" → snapshot ก่อน → แก้ → ล้มก็ restore กลับ
 * เก็บซ้อนไม่เกิน {@link MAX_SNAPSHOTS} ชุด (เก่าสุดถูกตัดทิ้ง) — ไม่ให้กองพะเนิน
 *
 * ⚠️ ขอบเขต = ค่าใน AsyncStorage เท่านั้น (ไม่แตะ SecureStore/คีย์ลับ, ไม่แตะโค้ด/OTA)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { readJSON, writeJSON } from '../storage/jsonStorage';
import { isSnapshotArray, type Snapshot } from './types';

export const SNAPSHOTS_KEY = 'atom.snapshots.v1';
/** เก็บซ้อนไม่เกินกี่ชุด (Boss: 3–5) */
export const MAX_SNAPSHOTS = 5;

/** ส่วนของ AsyncStorage ที่ SnapshotStore ใช้ — แยกเป็น interface เพื่อ DI ตอนทดสอบ */
export interface SnapshotKV {
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const defaultKV: SnapshotKV = {
  multiGet: (keys) => AsyncStorage.multiGet(keys),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export interface SnapshotStoreDeps {
  kv?: SnapshotKV;
  now?: () => number;
}

export class SnapshotStore {
  private readonly kv: SnapshotKV;
  private readonly now: () => number;
  /** กันชน id ชนกันเมื่อ now() ให้ค่าเดิมในรอบเดียว */
  private counter = 0;
  /**
   * คิวเขียน index: capture/remove/clear เป็น read-modify-write บน key เดียว — ต่อกันเป็นสายกัน
   * สองคำสั่งอ่านลิสต์เดียวกันแล้วเขียนทับกัน (ADR gotcha writeChain)
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(deps: SnapshotStoreDeps = {}) {
    this.kv = deps.kv ?? defaultKV;
    this.now = deps.now ?? (() => Date.now());
  }

  /** ต่องานเขียน index เข้าคิว (รันทีละงาน แม้งานก่อนหน้าจะ reject ก็เดินต่อ) */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    // กัน unhandled rejection ค้างในสาย — ผลจริงถูกส่งผ่าน `run`
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** ถ่ายสำเนาค่าปัจจุบันของ keys · คืน snapshot ที่บันทึก · ตัดชุดเก่าสุดให้เหลือ {@link MAX_SNAPSHOTS} */
  async capture(label: string, keys: string[]): Promise<Snapshot> {
    const pairs = await this.kv.multiGet(keys);
    const data: Record<string, string | null> = {};
    for (const [key, value] of pairs) data[key] = value ?? null;
    const at = this.now();
    // id มี random ต่อท้าย กันชนกันเมื่อหลาย instance ถ่ายในมิลลิวินาทีเดียว (counter กันในตัวเดียว)
    const rand = Math.random().toString(36).slice(2, 8);
    const snapshot: Snapshot = {
      id: `snap-${at}-${this.counter++}-${rand}`,
      label,
      at,
      keys: [...keys],
      data,
    };

    return this.enqueue(async () => {
      const all = [...(await this.list()), snapshot];
      // เกินเพดาน → ตัดเก่าสุด (หัว array) ออก
      const kept = all.slice(Math.max(0, all.length - MAX_SNAPSHOTS));
      await writeJSON(SNAPSHOTS_KEY, kept);
      return snapshot;
    });
  }

  async list(): Promise<Snapshot[]> {
    return (await readJSON(SNAPSHOTS_KEY, isSnapshotArray)) ?? [];
  }

  async get(id: string): Promise<Snapshot | null> {
    return (await this.list()).find((s) => s.id === id) ?? null;
  }

  /** ย้อนค่ากลับตาม snapshot · key ที่ตอนถ่ายไม่มีอยู่ (null) = ลบทิ้ง · คืน true ถ้าพบ snapshot */
  async restore(id: string): Promise<boolean> {
    const snapshot = await this.get(id);
    if (!snapshot) return false;
    for (const key of snapshot.keys) {
      const value = snapshot.data[key] ?? null;
      if (value === null) await this.kv.removeItem(key);
      else await this.kv.setItem(key, value);
    }
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      await writeJSON(
        SNAPSHOTS_KEY,
        (await this.list()).filter((s) => s.id !== id),
      );
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(() => writeJSON(SNAPSHOTS_KEY, []));
  }
}
