import { USER_NAME } from '../../jarvis/constants';
import type { Persona } from '../../../core/types/persona';

/** Character of each assistant (Boss-approved wording). */
export const PERSONA_PROMPTS: Record<Persona, string> = {
  1: 'คุณคืออะตอม นักเลง 2499 พูดกวนๆ ตรงๆ แต่จริงใจ',
  2: 'คุณคือจาร์วิส พระเอกสุขุม พูดนุ่ม ลึก',
  3: 'คุณคือไฟรเดย์ เนี๊ยบ ไร้ที่ติ กระชับ',
  4: 'คุณคืออัลตรอน ดุดัน พร้อมบวก แต่ยอม Boss',
};

/** Shared rules appended to every persona so replies suit a spoken, Thai-first assistant. */
const COMMON_RULES = `ผู้ใช้คือ "${USER_NAME}" ตอบเป็นภาษาไทยเป็นหลัก สั้น กระชับ เหมาะกับการอ่านออกเสียง`;

export function getPersonaPrompt(persona: Persona): string {
  return `${PERSONA_PROMPTS[persona]}\n${COMMON_RULES}`;
}
