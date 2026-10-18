import type { AIProviderId } from '../ai/core/types';

/**
 * รายชื่อโมเดลที่ดึงมาแล้ว เก็บในหน่วยความจำตลอด session (ไม่ลง storage — รายชื่อเปลี่ยนบ่อย
 * และดึงใหม่ได้เสมอ) · เปิด picker ซ้ำหรือออกจากหน้า AI แล้วกลับมา ไม่ต้องยิง API ใหม่
 * ล้างเมื่อบันทึก/ลบ key (key ใหม่อาจเห็นโมเดลไม่เหมือนเดิม) หรือกด "โหลดรายชื่อใหม่"
 */
const cache = new Map<AIProviderId, string[]>();

export const modelListCache = {
  get(id: AIProviderId): string[] | undefined {
    return cache.get(id);
  },
  set(id: AIProviderId, models: readonly string[]): void {
    cache.set(id, [...models]);
  },
  invalidate(id: AIProviderId): void {
    cache.delete(id);
  },
  /** สำหรับ test */
  clear(): void {
    cache.clear();
  },
};
