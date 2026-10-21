import type { Persona } from '../../../core/types/persona';
import { PERSONA_PROMPTS } from '../../ai/prompts/personaPrompts';
import { USER_NAME } from '../../jarvis/constants';
import { ASK_TOOL_NAME } from './RealtimeVoiceSession';
import type { RealtimeConfig } from './types';

/** เสียงของโมเดลเสียงต่อ persona (ชื่อเสียงของ OpenAI Realtime) */
export const REALTIME_VOICE_BY_PERSONA: Record<Persona, string> = {
  1: 'ash',
  2: 'cedar',
  3: 'marin',
  4: 'echo',
};

/**
 * prompt ของโมเดลเสียง — สั้นโดยตั้งใจ (ถูกคิดเงินทุกเทิร์น) ความจำ/ทักษะ/เครื่องมืออยู่ที่สมองของแอปที่
 * `ask_atom` เรียก ไม่ยัดเข้าที่นี่
 */
export function buildInstructions(persona: Persona): string {
  return [
    PERSONA_PROMPTS[persona],
    `ผู้ใช้คือ "${USER_NAME}" พูดไทย ตอบสั้น 1–2 ประโยค — คำตอบถูกอ่านออกเสียง ห้ามอ่านโค้ด ลิงก์ หรือสัญลักษณ์`,
    `คุยเล่น ทักทาย ถามความเห็นทั่วไป: ตอบเองได้เลย`,
    `เรื่องที่ต้องใช้ความจำของ${USER_NAME} จดบันทึก สั่งงานเครื่อง/คอมพิวเตอร์ ค้นข้อมูลจริง สลับผู้ช่วย หรือที่คุณไม่แน่ใจ: ` +
      `เรียก ${ASK_TOOL_NAME} ด้วยคำขอของผู้ใช้ตามที่พูด พูดสั้น ๆ ก่อนหนึ่งประโยค (เช่น "เดี๋ยวเช็กให้") ` +
      `แล้วอ่านผลที่ได้แบบกระชับ ห้ามพูดถึงระบบหลังบ้าน เครื่องมือ หรือการส่งต่อ`,
  ].join('\n');
}

export function buildRealtimeConfig(persona: Persona): RealtimeConfig {
  return {
    instructions: buildInstructions(persona),
    voice: REALTIME_VOICE_BY_PERSONA[persona],
    tools: [
      {
        name: ASK_TOOL_NAME,
        description: `ส่งคำขอของผู้ใช้เข้าสมองของแอป (ความจำ โน้ต เครื่องมือ การสั่งงานเครื่อง การค้นข้อมูล) แล้วได้คำตอบเป็นข้อความ`,
        parameters: {
          type: 'object',
          properties: {
            request: { type: 'string', description: 'คำขอของผู้ใช้ตามที่พูด ภาษาไทย' },
          },
          required: ['request'],
        },
      },
    ],
  };
}
