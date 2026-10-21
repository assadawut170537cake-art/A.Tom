/**
 * @file จำว่าโมเดลไหน "ติดโควต้า" แล้วพักไว้ชั่วคราว — ให้แอปปรับตัวเองเมื่อโควต้าหมด (Boss ขอ · ADR-017)
 *
 * ทำไม: โควต้าฟรีของ Gemini นับแยก **ต่อโมเดล** และรีเซ็ตเป็นรอบ (นาที/วัน) — ยิงซ้ำตัวที่หมดแล้ว
 * มีแต่เสียเวลาและเสีย request เปล่า ๆ · พักไว้แล้ว Orchestrator ข้ามไปรุ่นอื่น/เจ้าอื่นทันที
 *
 * พักครั้งแรก 60 วินาที (โควต้ารายนาทีรีเซ็ตทัน) แล้วเพิ่มเท่าตัวทุกครั้งที่กลับมาแล้วยังหมด สูงสุด 1 ชั่วโมง
 * (โควต้ารายวันหมด = ไม่ลองถี่) · ตอบได้เมื่อไร `clear()` นับใหม่ · จำในหน่วยความจำเท่านั้น (เปิดแอปใหม่ = ลองใหม่)
 */

import type { ProviderError } from '../../../core/http/errors';

export const QUOTA_COOLDOWN_MS = 60_000;
export const QUOTA_COOLDOWN_MAX_MS = 60 * 60_000;

/**
 * 429 ที่เป็น "โควต้าหมด" (Gemini: "You exceeded your current quota" / RESOURCE_EXHAUSTED) — สลับรุ่นช่วยได้
 * 429 ทั่วไป (ยิงถี่ชั่วคราว) ยังใช้กติกา retry/fallback เดิม
 */
export function isQuotaError(err: ProviderError): boolean {
  return err.kind === 'rate_limit' && /quota|exhaust/i.test(err.message);
}

interface Strike {
  until: number;
  count: number;
}

export class QuotaGuard {
  private readonly strikes = new Map<string, Strike>();

  constructor(private readonly now: () => number = Date.now) {}

  isCooling(providerId: string, model: string): boolean {
    const s = this.strikes.get(keyOf(providerId, model));
    return !!s && s.until > this.now();
  }

  /** บันทึกว่าติดโควต้า · คืนจำนวนครั้งติดกัน (1 = เพิ่งหมดรอบแรก ใช้ตัดสินใจแจ้งบอส) */
  strike(providerId: string, model: string): number {
    const key = keyOf(providerId, model);
    const count = (this.strikes.get(key)?.count ?? 0) + 1;
    const wait = Math.min(QUOTA_COOLDOWN_MS * 2 ** (count - 1), QUOTA_COOLDOWN_MAX_MS);
    this.strikes.set(key, { until: this.now() + wait, count });
    return count;
  }

  clear(providerId: string, model: string): void {
    this.strikes.delete(keyOf(providerId, model));
  }
}

const keyOf = (providerId: string, model: string) => `${providerId}\u0000${model}`;
