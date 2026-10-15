/** ค่ายาวสุดของข้อความหนึ่งบรรทัดที่ส่งเข้า prompt (ChatHandler.MAX_FACT_LENGTH ใช้ค่านี้) */
export const MAX_PROMPT_LINE = 200;

/**
 * อักขระขึ้นบรรทัดใหม่ทุกแบบที่ LLM อาจตีความเป็นบรรทัดใหม่ — รวม \v \f NEL (U+0085)
 * LINE/PARAGRAPH SEPARATOR (U+2028/2029) ไม่ใช่แค่ \r\n
 */
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]+/g;

/**
 * บีบข้อความ (memory fact, skill ที่ AI สร้าง, ผลจาก MCP) ให้อยู่บรรทัดเดียว: ข้อความที่มี "\n\nSystem: ..."
 * จะสร้างบรรทัดที่หน้าตาเหมือนคำสั่งระบบใน prompt ไม่ได้ (กันได้แค่การปลอมโครงสร้าง — ดู ADR-011)
 */
export function toPromptLine(text: string, max: number = MAX_PROMPT_LINE): string {
  return text.replace(LINE_BREAKS, ' ').trim().slice(0, max);
}
