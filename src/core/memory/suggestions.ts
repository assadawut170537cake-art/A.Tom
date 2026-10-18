/**
 * @file ความจำที่ AI เสนอ — AI ต่อท้ายคำตอบด้วย `[[จำ: key=value]]` แล้วแอปถามบอสก่อนบันทึก
 *
 * ไม่บันทึกเองอัตโนมัติ: เนื้อหา fact ถูกแนบเข้า system prompt ทุกรอบ (ADR-011) — ถ้า AI ถูกหลอก
 * (เช่น จากหน้าเว็บที่ค้นมา) ให้จำคำสั่งแปลก ๆ บอสจะเห็นก่อนเสมอ
 */

import type { MemorySuggestion } from '../types/message';
import { MAX_PROMPT_LINE } from './promptLine';
import { MEMORY_KEY_PATTERN } from './types';

export { isMemorySuggestion, type MemorySuggestion } from '../types/message';

/** ต่อข้อความนี้ใน system prompt — สอน AI ให้เสนอความจำ */
export const MEMORY_SUGGESTION_INSTRUCTION = [
  'ถ้าบอสบอกข้อมูลเกี่ยวกับตัวเองที่ควรจำไว้ใช้ครั้งหน้า (ชื่อ คนในครอบครัว งาน ความชอบ สิ่งที่แพ้ เป้าหมาย นัดประจำ)',
  'ให้ต่อท้ายคำตอบด้วยบรรทัด [[จำ: key=value]] ต่อหนึ่งเรื่อง (key ภาษาอังกฤษ snake_case เช่น favorite_food, value ภาษาไทยสั้น ๆ)',
  'ไม่ต้องเสนอเรื่องที่จำไว้แล้ว เรื่องชั่วคราว หรือเรื่องที่บอสไม่ได้พูดเอง และไม่ต้องพูดถึงบรรทัดนี้ในคำตอบ',
].join('\n');

const MARKER = /\[\[\s*(?:จำ|remember)\s*:\s*([^=\]\n]+?)\s*=\s*([^\]\n]+?)\s*\]\]/gi;
/** มาร์กเกอร์ที่ยังไหลมาไม่ครบ (ท้ายข้อความขณะ stream) */
const PARTIAL_TAIL = /\[(?:\[[^\]\n]*)?$/;
const MAX_SUGGESTIONS = 3;

const normalizeKey = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

/** แยกมาร์กเกอร์ออก → ข้อความที่แสดง + ความจำที่เสนอ (key ผิดรูป/ค่าว่าง/ยาวเกินถูกทิ้ง) */
export function extractMemorySuggestions(text: string): { text: string; suggestions: MemorySuggestion[] } {
  const suggestions: MemorySuggestion[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MARKER)) {
    const key = normalizeKey(m[1] ?? '');
    const value = (m[2] ?? '').trim();
    if (!MEMORY_KEY_PATTERN.test(key) || !value || value.length > MAX_PROMPT_LINE || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ key, value });
  }
  const clean = text.replace(MARKER, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
}

/** สำหรับข้อความที่กำลังไหล: ซ่อนมาร์กเกอร์ทั้งที่ครบแล้วและที่ยังมาไม่ครบ */
export function stripMemoryMarkers(partial: string): string {
  return partial.replace(MARKER, '').replace(PARTIAL_TAIL, '').trimEnd();
}
