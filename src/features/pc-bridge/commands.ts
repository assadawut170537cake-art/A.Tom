/**
 * @file ข้อความของ Boss → instruction ที่ Mark 55 รู้จัก (mark55/handlers.py)
 *
 * ต้องตรงกับตาราง `mobile_instructions` ใน Supabase — instruction นอกตารางนั้น RPC ปฏิเสธอยู่แล้ว
 * เพิ่มคำสั่งใหม่: handler ฝั่ง Mark 55 → INSERT ใน mobile_instructions → เพิ่มแถวใน {@link PC_COMMANDS}
 */

import type { ModuleCommand } from '../../core/modules/types';
import type { BusTask } from './MemoryBusClient';

export interface PcCommandSpec {
  instruction: string;
  /** ชื่อที่ Boss เห็นในคำตอบ */
  label: string;
  /** ตรวจกับข้อความทั้งประโยค */
  pattern: RegExp;
}

export const PC_COMMANDS: readonly PcCommandSpec[] = [
  { instruction: 'RUN_DIAGNOSTICS', label: 'เช็กเครื่อง', pattern: /เช็[กค]|ตรวจ|สถานะ|สุขภาพ|diagnos|health|status/i },
  { instruction: 'EXECUTE_BUILD', label: 'บิลด์', pattern: /บิ[ลว]ด์|บิ้ว|\bbuild\b/i },
];

/** ข้อความต้นฉบับส่งไปเป็น context ให้ handler · ตัดให้สั้นเพราะ payload จำกัด 4 KB */
const MAX_TEXT_IN_PAYLOAD = 500;

export interface ResolvedCommand {
  spec: PcCommandSpec;
  payload: Record<string, unknown>;
}

export function resolveCommand(command: ModuleCommand): ResolvedCommand | null {
  const spec = PC_COMMANDS.find((c) => c.pattern.test(command.text));
  if (!spec) return null;
  return { spec, payload: { text: command.text.slice(0, MAX_TEXT_IN_PAYLOAD), source: 'atom-mobile' } };
}

export function unsupportedReply(): string {
  return `Mark 55 ยังรับคำสั่งนี้ไม่ได้ครับ — ตอนนี้สั่งได้: ${PC_COMMANDS.map((c) => c.label).join(' · ')}`;
}

/** ผลจาก handler (dict อะไรก็ได้) → ข้อความสั้น ๆ ในแชท */
export function describeResult(task: BusTask, label: string): string {
  const { result } = task;
  if (task.status === 'FAILED') {
    const reason = typeof result.exception === 'string' ? result.exception : typeof result.error === 'string' ? result.error : JSON.stringify(result);
    return `Mark 55 ทำ "${label}" ไม่สำเร็จ: ${reason}`;
  }
  const status = typeof result.status === 'string' ? result.status : 'เสร็จแล้ว';
  const extra = Object.entries(result).filter(([k]) => k !== 'status' && k !== 'task_id');
  const details = extra.length > 0 ? ` (${extra.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')})` : '';
  return `Mark 55 ทำ "${label}" เสร็จแล้ว — ${status}${details}`;
}
