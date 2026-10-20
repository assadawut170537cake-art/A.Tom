/**
 * @file Module `supermemory` (CORE_AUDIT task 5.1) — ดึง API key + ส่ง fact ขึ้น space ร่วมของทีม
 *
 * ย้ายออกจากแกน: เดิม boot เรียก `secretSync.importOnce()` + `superMemorySync.start()` ตรง ๆ
 * ตอนนี้ห่อเป็น module เปิด/ปิดได้ผ่าน ModuleRegistry (ค่าเริ่มต้นเปิด = พฤติกรรมเดิมไม่เปลี่ยน)
 * ปิด module → หยุดส่งขึ้น Supermemory/หยุดดึงคีย์ แต่ **แกนยังจำในเครื่องได้ตามปกติ** (LocalMemory ไม่เกี่ยว)
 *
 * service จริง (`SuperMemorySyncService`/`SecretSync`) ยังอยู่ใน core — module นี้คือ "วงจรชีวิต" ที่เสียบเข้า registry
 */

import { secretSync, type SecretSync } from '../../core/memory/SecretSync';
import { superMemorySync, type SuperMemorySyncService } from '../../core/memory/SuperMemorySync';
import type { AtomModule } from '../../core/modules/types';

export const SUPERMEMORY_ID = 'supermemory';

export interface SupermemoryDeps {
  secrets: Pick<SecretSync, 'importOnce'>;
  sync: Pick<SuperMemorySyncService, 'start' | 'stop'>;
}

const DEFAULT_DEPS: SupermemoryDeps = { secrets: secretSync, sync: superMemorySync };

export class SupermemoryModule implements AtomModule {
  readonly id = SUPERMEMORY_ID;
  readonly name = 'Supermemory';
  readonly description = 'ดึงคีย์ + ส่งความจำขึ้น space ร่วมของทีม (ปิดได้ · แกนยังจำในเครื่อง)';
  readonly enabled = true;
  private readonly deps: SupermemoryDeps;

  constructor(deps: Partial<SupermemoryDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async init(): Promise<void> {
    // ดึงคีย์ที่บอสเก็บใน Supermemory มาใส่ SecureStore (ไม่มีคีย์/เน็ตล่ม = ข้าม · ล้มแค่ log ไม่ทำให้ init ล้ม)
    try {
      await this.deps.secrets.importOnce();
    } catch (e) {
      console.error('[supermemory] ดึงคีย์จาก Supermemory ไม่สำเร็จ — ใส่เองได้ตามปกติ', e);
    }
    // แยก try: subscribe ล้มต้องไม่ลบล้างผลของ importOnce และไม่ทำให้ทั้ง module ล้ม (fail-open เหมือน boot เดิม)
    try {
      this.deps.sync.start(); // เริ่มฟัง Shared Memory → POST fact ขึ้น Supermemory
    } catch (e) {
      console.error('[supermemory] เริ่มส่งขึ้น Supermemory ไม่สำเร็จ — แอปทำงานต่อได้', e);
    }
  }

  dispose(): void {
    this.deps.sync.stop();
  }
}

export default new SupermemoryModule();
