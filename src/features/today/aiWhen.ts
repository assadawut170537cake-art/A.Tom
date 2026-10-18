/**
 * @file ทางสำรองเมื่อ {@link parseThaiWhen} อ่านเวลาไม่ออก — ให้ LLM แยก "เมื่อไร" + "เรื่องอะไร" เป็น JSON
 *
 * ให้ LLM ตอบเป็นเวลาท้องถิ่นแบบตัวเลข (ไม่ใช่ ISO มี timezone) แล้วสร้าง Date เองในเครื่อง
 * เพราะ model มักเดา timezone ผิด · ตอบไม่ใช่ JSON / ไม่มีเวลา / ล้ม → null (ผู้เรียกตอบบอสให้บอกเวลาใหม่)
 */

import type { AgentLLM } from '../../core/agent/types';
import { isRecord, isString } from '../../core/types/guards';
import { orchestratorLLM } from '../ai/agent';
import type { ParsedWhen } from './thaiTime';

const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const;
const pad = (n: number) => String(n).padStart(2, '0');

function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (วัน${TH_DAYS[d.getDay()] ?? ''})`;
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** ดึง JSON ก้อนแรกจากคำตอบ (model ชอบห่อด้วย ```json) */
function firstJSON(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractWhenWithAI(
  sentence: string,
  now: number = Date.now(),
  llm: AgentLLM = orchestratorLLM()
): Promise<ParsedWhen | null> {
  const prompt = [
    `ตอนนี้คือ ${localStamp(now)} เวลาประเทศไทย`,
    'แยกเวลาที่ต้องเตือน และเรื่องที่ต้องทำ ออกจากประโยคของผู้ใช้',
    'ตอบเป็น JSON บรรทัดเดียวเท่านั้น: {"at":"YYYY-MM-DD HH:mm","text":"<เรื่องที่ต้องทำ สั้น ๆ>"}',
    'ถ้าประโยคไม่บอกเวลาเลย ตอบ {"at":null}',
  ].join('\n');
  let reply: string;
  try {
    reply = await llm.chat([
      { role: 'system', content: prompt },
      { role: 'user', content: sentence },
    ]);
  } catch (e) {
    console.error('[reminders] ให้ AI อ่านเวลาไม่สำเร็จ', e);
    return null;
  }
  const json = firstJSON(reply);
  if (!isRecord(json) || !isString(json.at)) return null;
  const m = LOCAL_TIME.exec(json.at);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined) return null;
  const at = new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  if (!Number.isFinite(at) || at <= now) return null;
  return { at, text: isString(json.text) ? json.text.trim() : '' };
}
