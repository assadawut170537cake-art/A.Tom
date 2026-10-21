/**
 * @file SelfRepair — วงจรซ่อมตัวเองของการตั้งค่า/ข้อมูล (CONCEPT ข้อ 4)
 *
 * 1. จะซ่อม → snapshot ก่อน (ผ่าน {@link SnapshotStore})
 * 2. ลองวิธีซ่อมทีละวิธี — วิธีที่ "เคยได้ผลกับปัญหานี้" ถูกเลื่อนขึ้นก่อน (ครั้งหน้าซ่อมเร็วขึ้น)
 * 3. วิธีไหนสำเร็จ → บันทึกว่าได้ผล + ลบ snapshot (ไม่ต้องย้อนแล้ว)
 *    วิธีไหนล้ม → บันทึกว่าไม่ได้ผล + ย้อนกลับ snapshot แล้วลองวิธีถัดไป
 * 4. ทุกวิธีล้ม → ย้อนไว้ที่เดิม ลบ snapshot (ไม่มีอะไรให้ย้อนต่อ) คืน ok:false
 *
 * ⚠️ วิธีซ่อม (`RepairMethod.run`) ทำได้แค่กับการตั้งค่า/ข้อมูล — ห้ามแก้โค้ด/OTA (ด่านรอบอสอนุมัติ)
 */

import { readJSON, writeJSON } from '../storage/jsonStorage';
import { SnapshotStore } from './SnapshotStore';
import { isRepairLog, type RepairAttempt } from './types';

export const REPAIR_LOG_KEY = 'atom.repair.log.v1';
/** เก็บประวัติการซ่อมล่าสุดกี่รายการ */
export const MAX_REPAIR_LOG = 50;

/** ต่อท้ายบันทึกการซ่อม (ตัดให้เหลือ {@link MAX_REPAIR_LOG}) — ใช้ร่วมได้ทั้ง SelfRepair และ SettingsHealth */
export async function recordRepair(attempt: RepairAttempt): Promise<void> {
  const all = [...((await readJSON(REPAIR_LOG_KEY, isRepairLog)) ?? []), attempt];
  await writeJSON(REPAIR_LOG_KEY, all.slice(Math.max(0, all.length - MAX_REPAIR_LOG)));
}

/** วิธีซ่อมหนึ่งวิธี — `run()` คืน true = แก้สำเร็จ · ไม่ควร throw (throw = ถือว่าล้ม) */
export interface RepairMethod {
  name: string;
  run(): Promise<boolean>;
}

export interface RepairResult {
  ok: boolean;
  /** ชื่อวิธีที่แก้สำเร็จ (ถ้ามี) */
  method?: string;
  /** ลำดับวิธีที่ลองจริง (หลังจัดเรียงตามประวัติ) */
  tried: string[];
}

export interface SelfRepairDeps {
  snapshots?: SnapshotStore;
  now?: () => number;
}

export class SelfRepair {
  private readonly snapshots: SnapshotStore;
  private readonly now: () => number;

  constructor(deps: SelfRepairDeps = {}) {
    this.snapshots = deps.snapshots ?? new SnapshotStore();
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * ซ่อมปัญหาหนึ่ง: snapshot keys → ลองวิธีตามลำดับ (วิธีที่เคยได้ผลมาก่อน) → สำเร็จหยุด, ล้มย้อนแล้วลองต่อ
   */
  async repair(problem: string, keys: string[], methods: RepairMethod[]): Promise<RepairResult> {
    const snapshot = await this.snapshots.capture(problem, keys);
    const ordered = await this.order(problem, methods);
    const tried: string[] = [];

    for (const method of ordered) {
      tried.push(method.name);
      let fixed = false;
      try {
        fixed = await method.run();
      } catch {
        fixed = false; // วิธีที่ throw = ถือว่าล้ม (ไม่ทำให้ลูปพัง)
      }
      await this.log({
        problem,
        method: method.name,
        outcome: fixed ? 'success' : 'fail',
        at: this.now(),
      });
      if (fixed) {
        await this.forget(snapshot.id); // ไม่ต้องย้อนแล้ว (ลบแบบ best-effort)
        return { ok: true, method: method.name, tried };
      }
      // ล้ม → ย้อนก่อนลองวิธีถัดไป · ย้อนไม่สำเร็จ (storage ล่ม / snapshot ถูกตัด) = สภาพไม่แน่นอน → หยุด
      let rolledBack = false;
      try {
        rolledBack = await this.snapshots.restore(snapshot.id);
      } catch {
        rolledBack = false;
      }
      if (!rolledBack) {
        await this.forget(snapshot.id);
        return { ok: false, tried };
      }
    }

    await this.forget(snapshot.id); // ย้อนไว้ที่เดิมแล้ว ไม่ต้องเก็บ snapshot ต่อ
    return { ok: false, tried };
  }

  /** ลบ snapshot แบบ best-effort — ลบไม่ได้ (storage ล่ม) ก็ไม่ทำให้ผลการซ่อมเพี้ยน (เดี๋ยวถูกตัดตามเพดาน) */
  private async forget(id: string): Promise<void> {
    try {
      await this.snapshots.remove(id);
    } catch {
      // ปล่อยไว้ — MAX_SNAPSHOTS จะตัดทิ้งเองภายหลัง
    }
  }

  /** ประวัติการซ่อมล่าสุด (ใหม่สุดท้าย array) */
  async history(): Promise<RepairAttempt[]> {
    return (await readJSON(REPAIR_LOG_KEY, isRepairLog)) ?? [];
  }

  /**
   * จัดลำดับวิธี: วิธีที่ครั้ง **ล่าสุด** กับปัญหานี้ "สำเร็จ" ขึ้นก่อน (เรียงตามเวลาล่าสุด)
   * ดูผลครั้งล่าสุดเท่านั้น — วิธีที่เคยสำเร็จแต่หลัง ๆ ล้มตลอด จะไม่ถูกดันขึ้นหน้าอีก (กันลองของเสียซ้ำ)
   */
  private async order(problem: string, methods: RepairMethod[]): Promise<RepairMethod[]> {
    const log = await this.history();
    // log เรียงตามเวลา (append) → ตัวหลังทับตัวหน้า = ผลครั้งล่าสุดของแต่ละวิธี
    const last = new Map<string, RepairAttempt>();
    for (const a of log) {
      if (a.problem === problem) last.set(a.method, a);
    }
    const scoreOf = (name: string): number => {
      const a = last.get(name);
      return a && a.outcome === 'success' ? a.at : -1; // สำเร็จล่าสุด = เวลา · อื่น ๆ = -1 (คงลำดับเดิม)
    };
    // เสถียร: เรียงตามเวลาที่สำเร็จล่าสุด (มาก→ขึ้นก่อน) · ที่เหลือคงลำดับที่ส่งมา
    return methods
      .map((method, index) => ({ method, index, score: scoreOf(method.name) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((e) => e.method);
  }

  private async log(attempt: RepairAttempt): Promise<void> {
    await recordRepair(attempt);
  }
}
