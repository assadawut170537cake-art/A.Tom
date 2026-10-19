/**
 * @file ชนิดข้อมูลสำหรับ "ห้องแชทเดียวกัน" — ซิงก์ประวัติแชทข้ามเครื่อง (ADR-015: อะตอมบนมือถือ = Mark 55 บน PC ห้องเดียวกัน)
 *
 * ต่างจาก Shared Memory (key→value, upsert + ลบ) — แชทเป็น **append-only**: ข้อความใหม่ต่อท้าย ไม่แก้ของเก่า
 * จึงไม่มี conflict/tombstone · ตัวตนของข้อความ = `id` (เครื่องที่พิมพ์เป็นคนสร้าง) → ซ้ำ = ตัวเดียวกัน ข้ามได้
 *
 * ซิงก์เฉพาะบทสนทนาจริง (`user` / `assistant`) — ข้อความ `system` (เช่น "📩 Mark 55: …", แจ้งโหมดเฝ้า)
 * เป็นของเฉพาะเครื่อง ไม่ส่งข้ามไป (ไม่งั้นอีกเครื่องเห็นแจ้งเตือนที่ไม่เกี่ยวกับตัวเอง)
 */

import { isNumber, isOneOf, isRecord, isString } from '../types/guards';
import { type MessageRole } from '../types/message';
import { isPersona, type Persona } from '../types/persona';

/** เวอร์ชันรูปแบบข้อมูล (เหมือน SYNC_VERSION ของ memory) — server ตรวจว่าตรงกัน */
export const CHAT_SYNC_VERSION = 'atom.chat.v1';

/** role ที่ซิงก์ข้ามเครื่อง — `system` ไม่ซิงก์ (เป็นข้อความเฉพาะเครื่อง) */
export const SYNCABLE_ROLES = ['user', 'assistant'] as const satisfies readonly MessageRole[];
export type SyncableRole = (typeof SYNCABLE_ROLES)[number];

/** ข้อความหนึ่งข้อความบน wire (ตรงกับ {@link ../types/message.Message} แต่ persona เป็น string บน wire) */
export interface SyncMessage {
  id: string;
  persona: Persona;
  role: SyncableRole;
  content: string;
  /** epoch ms ตามนาฬิกาของเครื่องที่พิมพ์ */
  createdAt: number;
}

export const isSyncableRole = (role: MessageRole): role is SyncableRole =>
  isOneOf(SYNCABLE_ROLES, role);

/** parse ข้อความจาก server — รูปแบบผิด = null (ผู้เรียกข้ามทิ้ง ไม่ให้ sync ทั้งรอบล้ม) */
export function parseSyncMessage(value: unknown): SyncMessage | null {
  if (!isRecord(value)) return null;
  const persona = Number(value.persona);
  if (!isString(value.id) || !value.id) return null;
  if (!isPersona(persona)) return null;
  if (!isString(value.role) || !isOneOf(SYNCABLE_ROLES, value.role)) return null;
  if (!isString(value.content) || !isNumber(value.createdAt)) return null;
  return {
    id: value.id,
    persona,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
  };
}

/** แปลงเป็น wire (persona → string ให้ตรงกับ memory wire format) */
export function toWireMessage(message: SyncMessage): Record<string, unknown> {
  return {
    id: message.id,
    persona: String(message.persona),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}
