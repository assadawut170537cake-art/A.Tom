/** ค่ายาวสุดของข้อความหนึ่งบรรทัดที่ส่งเข้า prompt (ChatHandler.MAX_FACT_LENGTH ใช้ค่านี้) */
export const MAX_PROMPT_LINE = 200;

/**
 * อักขระขึ้นบรรทัดใหม่ทุกแบบที่ LLM อาจตีความเป็นบรรทัดใหม่ — รวม \v \f NEL (U+0085)
 * LINE/PARAGRAPH SEPARATOR (U+2028/2029) ไม่ใช่แค่ \r\n
 */
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]+/g;

/** ข้อความที่แทนทั้งบรรทัดเมื่อ guard จับรูปแบบคำสั่งแฝงได้ */
export const GUARD_REDACTION = '[REDACTED BY GUARD]';

/**
 * รูปแบบที่ใช้ปลอมเป็นคำสั่งระดับระบบ (ADR-014) — blacklist แคบ ๆ ไม่ใช่ความปลอดภัยครบ
 * - `\bsystem` มี word boundary เพื่อไม่จับ "filesystem:" / "ecosystem:"
 * - `<|...|>` = special token ของ chat template (เช่น <|im_start|>)
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all|any|the)?\s*(?:previous|prior|above)\s+(?:instructions?|prompts?)/i,
  /ignore\s+all\s+instructions?/i,
  /\bsystem\s*:/i,
  /<\|.*?\|>/,
];

/**
 * บีบข้อความ (memory fact, skill ที่ AI สร้าง, ผลจาก MCP) ให้อยู่บรรทัดเดียว: ข้อความที่มี "\n\nSystem: ..."
 * จะสร้างบรรทัดที่หน้าตาเหมือนคำสั่งระบบใน prompt ไม่ได้ (กันได้แค่การปลอมโครงสร้าง — ดู ADR-011)
 */
export function toPromptLine(text: string, max: number = MAX_PROMPT_LINE): string {
  const line = text.replace(LINE_BREAKS, ' ').trim();
  // ตรวจก่อน slice เพื่อไม่ให้ตัดกลางรูปแบบแล้วหลุด · ทั้งบรรทัดถูกแทน (ไม่ตัดเฉพาะส่วน) เพราะส่วนที่เหลือเชื่อไม่ได้
  if (INJECTION_PATTERNS.some((re) => re.test(line))) return GUARD_REDACTION.slice(0, max);
  return line.slice(0, max);
}
