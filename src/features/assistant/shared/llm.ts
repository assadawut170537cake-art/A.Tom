import { aiOrchestrator } from '../../ai/core/Orchestrator';
import { AssistantError } from './errors';
import { nowContext } from './time';

export interface Llm {
  complete(system: string, user: string): Promise<string>;
}

/** LLM ของแอป (temperature 0 เพื่อให้ตอบ JSON คงที่) */
export const appLlm: Llm = {
  complete: async (system, user) =>
    (
      await aiOrchestrator.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
      })
    ).content,
};

/** ดึง JSON object ก้อนแรกจากคำตอบของ LLM (ทน markdown fence / ข้อความนำหน้า) */
export function parseJsonLoose(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * ให้ LLM แปลงประโยคของบอสเป็น JSON ตาม `shape` (คำอธิบายรูปแบบ) แล้วตรวจด้วย `guard`
 * ใส่เวลาปัจจุบันให้เสมอ เพื่อแปลง "พรุ่งนี้" "อีก 2 ชั่วโมง" ได้ถูก
 */
export async function extractJson<T>(
  llm: Llm,
  task: string,
  shape: string,
  text: string,
  guard: (value: Record<string, unknown>) => T | null,
  now: Date = new Date(),
): Promise<T> {
  const system = `${task}\n${nowContext(now)}\nตอบเป็น JSON ก้อนเดียวเท่านั้น ไม่มีคำอธิบาย รูปแบบ: ${shape}`;
  const parsed = parseJsonLoose(await llm.complete(system, text));
  const value = parsed ? guard(parsed) : null;
  if (value === null) throw new AssistantError('ไม่เข้าใจคำสั่งนี้ครับ — ลองพูดให้ชัดขึ้นอีกนิด');
  return value;
}

export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
