/**
 * @file SettingsHealth — ตรวจความสมบูรณ์ของ blob การตั้งค่าใน AsyncStorage แล้วกู้อย่างปลอดภัย (CONCEPT ข้อ 4)
 *
 * กติกาจาก architect (DeepSeek · Q1):
 * 1. แยก `parse_fail` (JSON พังสิ้นเชิง) ออกจาก `schema_fail` (JSON ถูกแต่ผิดรูป) —
 *    parse_fail = กู้เป็น default ได้ · schema_fail = **กักกัน (quarantine) ไม่ reset อัตโนมัติ** (กันลบของที่อาจกู้คืนได้)
 * 2. **snapshot ก่อนซ่อมทุกครั้ง** — snapshot ล้มก็ซ่อมต่อ แต่บันทึก `snapshotFailed: true`
 * 3. **ตรวจซ้ำหลัง reset เสมอ** — ถ้ายังเสีย = หยุด ไม่ retry + log `fail`
 * 4. **แจ้งบอส** ผ่านข้อความระบบถาวรในแชท (ผู้เรียกส่ง `notify` มา)
 *
 * ⚠️ ขอบเขต = การตั้งค่า/ข้อมูลใน AsyncStorage · ไม่แตะคีย์ลับ/ประวัติแชท (ผู้เรียกไม่ลงทะเบียน key พวกนั้น)
 */

import type { Guard } from '../types/guards';

export type HealthStatus = 'ok' | 'parse_fail' | 'schema_fail';

/** blob หนึ่งที่เฝ้า — `reset()` เขียนค่าเริ่มต้น/ลบ key (ผู้เรียกกำหนดเอง) */
export interface HealthEntry {
  key: string;
  label: string;
  guard: Guard<unknown>;
  reset: () => Promise<void>;
}

/** ผลการจัดการ blob หนึ่ง (ไว้ให้ผู้เรียก/เทสต์ตรวจ) */
export interface HealthResult {
  key: string;
  status: HealthStatus;
  /** 'none' = ปกติ · 'reset' = กู้เป็น default · 'quarantine' = กักกัน raw ไว้ · 'reset-failed' = กู้ไม่สำเร็จ */
  action: 'none' | 'reset' | 'quarantine' | 'reset-failed' | 'error';
  snapshotFailed: boolean;
}

/** ถ่าย snapshot ก่อนซ่อม — แยก interface เพื่อ DI (จริง = SnapshotStore) */
export interface SnapshotTaker {
  capture(label: string, keys: string[]): Promise<unknown>;
}

export interface SettingsHealthKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SettingsHealthDeps {
  snapshots: SnapshotTaker;
  kv: SettingsHealthKV;
  now?: () => number;
  /** แจ้งบอส (ข้อความระบบถาวรในแชท) */
  notify?: (message: string) => void;
  /** บันทึกการเรียนรู้ (ค่าเริ่มต้น = เขียน REPAIR_LOG_KEY ร่วมกับ SelfRepair) */
  log?: (attempt: import('./types').RepairAttempt) => Promise<void>;
}

/** key ที่กักกัน raw เสียไว้ให้บอสตรวจ/กู้เอง — 1 key ต่อ blob (ของใหม่ทับของเก่า ไม่กองสะสม) */
export function quarantineKey(key: string): string {
  return `atom.quarantine.${key}`;
}

export class SettingsHealth {
  private readonly snapshots: SnapshotTaker;
  private readonly kv: SettingsHealthKV;
  private readonly now: () => number;
  private readonly notify: (message: string) => void;
  private readonly logAttempt: (attempt: import('./types').RepairAttempt) => Promise<void>;

  constructor(deps: SettingsHealthDeps) {
    this.snapshots = deps.snapshots;
    this.kv = deps.kv;
    this.now = deps.now ?? (() => Date.now());
    this.notify = deps.notify ?? (() => undefined);
    this.logAttempt = deps.log ?? (async () => undefined);
  }

  /** ตรวจสถานะ blob หนึ่ง — ไม่แก้ไขอะไร */
  async classify(entry: HealthEntry): Promise<{ status: HealthStatus; raw: string | null }> {
    const raw = await this.kv.getItem(entry.key);
    if (raw == null) return { status: 'ok', raw };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'parse_fail', raw };
    }
    return { status: entry.guard(parsed) ? 'ok' : 'schema_fail', raw };
  }

  /**
   * ตรวจ+กู้ทุก blob (เรียกครั้งเดียวตอน boot) · ไม่ throw — blob หนึ่งพังไม่ลาม
   * อ่านสถานะทุก blob พร้อมกัน (เร็ว · ไม่เขียน) แล้วค่อยซ่อมทีละตัวตามลำดับ (กัน log/snapshot เขียนชนกัน)
   */
  async check(entries: HealthEntry[]): Promise<HealthResult[]> {
    const classified = await Promise.all(
      entries.map(async (entry) => ({ entry, ...(await this.classify(entry)) })),
    );
    const results: HealthResult[] = [];
    for (const c of classified) {
      if (c.status === 'ok') {
        results.push({ key: c.entry.key, status: 'ok', action: 'none', snapshotFailed: false });
        continue;
      }
      try {
        results.push(await this.heal(c.entry, c.status, c.raw));
      } catch {
        // ล้มกลางคัน (เช่น setItem สำเร็จ removeItem พัง) — รายงานเป็น error ไม่กลบว่า "ปกติ"
        results.push({
          key: c.entry.key,
          status: c.status,
          action: 'error',
          snapshotFailed: false,
        });
      }
    }
    return results;
  }

  private async heal(
    entry: HealthEntry,
    status: Exclude<HealthStatus, 'ok'>,
    raw: string | null,
  ): Promise<HealthResult> {
    // (2) snapshot บังคับก่อนแตะต้อง — ล้มก็ซ่อมต่อ แต่จดไว้
    const snapshotFailed = await this.snapshot(entry);
    const at = this.now();

    // (1) schema_fail → กักกัน ไม่ reset อัตโนมัติ (กันลบของที่อาจกู้ได้)
    if (status === 'schema_fail') {
      if (raw != null) await this.kv.setItem(quarantineKey(entry.key), raw);
      await this.kv.removeItem(entry.key); // เคลียร์ของเสียออกจาก key จริง → แอปใช้ default สะอาด ๆ (raw ยังอยู่ใน quarantine)
      await this.logAttempt({
        problem: entry.key,
        method: 'quarantine',
        outcome: 'fail',
        at,
        note: 'schema_fail quarantined',
        snapshotFailed,
      });
      this.notify(
        `⚠️ การตั้งค่า "${entry.label}" รูปแบบไม่ตรง — เก็บสำรองไว้ตรวจแล้ว ใช้ค่าเริ่มต้นไปก่อน (ไม่ได้ลบของเดิม)`,
      );
      return { key: entry.key, status, action: 'quarantine', snapshotFailed };
    }

    // parse_fail → reset เป็น default แล้ว (3) ตรวจซ้ำ
    await entry.reset();
    const after = (await this.classify(entry)).status;
    if (after === 'ok') {
      await this.logAttempt({
        problem: entry.key,
        method: 'reset',
        outcome: 'success',
        at,
        snapshotFailed,
      });
      this.notify(
        snapshotFailed
          ? `⚠️ การตั้งค่า "${entry.label}" เสียหาย — กู้เป็นค่าเริ่มต้นให้แล้ว (สำรองของเดิมไม่สำเร็จ ของเดิมหาย)`
          : `⚠️ การตั้งค่า "${entry.label}" เสียหาย — กู้เป็นค่าเริ่มต้นให้แล้ว (สำรองของเดิมไว้)`,
      );
      return { key: entry.key, status, action: 'reset', snapshotFailed };
    }
    // ยังเสียหลัง reset → หยุด ไม่ retry
    await this.logAttempt({
      problem: entry.key,
      method: 'reset',
      outcome: 'fail',
      at,
      note: 'still invalid after reset',
      snapshotFailed,
    });
    this.notify(
      `⚠️ การตั้งค่า "${entry.label}" เสียหายและกู้อัตโนมัติไม่สำเร็จ — โปรดตรวจที่หน้า ตั้งค่า`,
    );
    return { key: entry.key, status, action: 'reset-failed', snapshotFailed };
  }

  /** คืน true ถ้า snapshot ล้ม (ซ่อมต่อได้ แต่ย้อนไม่ได้) */
  private async snapshot(entry: HealthEntry): Promise<boolean> {
    try {
      await this.snapshots.capture(`ซ่อม ${entry.label}`, [entry.key]);
      return false;
    } catch {
      return true;
    }
  }
}
