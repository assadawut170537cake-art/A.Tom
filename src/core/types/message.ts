/**
 * @file ข้อความแชทหนึ่งข้อความ — รูปแบบที่เก็บใน ChatHistoryStorage และแสดงใน UI
 */

import { isNumber, isOneOf, isRecord, isString } from './guards';
import type { Persona } from './persona';

export const ATTACHMENT_KINDS = ['image', 'file'] as const;

/** ไฟล์แนบของข้อความ — ไฟล์ถูกคัดลอกไว้ในโฟลเดอร์ของแอป (`uri`) อ่านเป็น base64 ตอนส่งให้ AI */
export interface Attachment {
  id: string;
  kind: (typeof ATTACHMENT_KINDS)[number];
  uri: string;
  mimeType: string;
  name: string;
  /** bytes (null = ไม่ทราบ) */
  size: number | null;
}

export function isAttachment(value: unknown): value is Attachment {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isOneOf(ATTACHMENT_KINDS, value.kind) &&
    isString(value.uri) &&
    isString(value.mimeType) &&
    isString(value.name) &&
    (value.size === null || isNumber(value.size))
  );
}

/** ความจำที่ AI เสนอในคำตอบนี้ — รอบอสกด "จำ" (ดู core/memory/suggestions.ts) */
export interface MemorySuggestion {
  key: string;
  value: string;
}

export function isMemorySuggestion(value: unknown): value is MemorySuggestion {
  return isRecord(value) && isString(value.key) && isString(value.value);
}

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Message {
  id: string;
  persona: Persona;
  role: MessageRole;
  content: string;
  /** epoch ms */
  createdAt: number;
  /** รูป/ไฟล์ที่บอสแนบมากับข้อความ */
  attachments?: Attachment[] | undefined;
  /** ความจำที่ผู้ช่วยเสนอ (ยังไม่บันทึก) — หายไปเมื่อบอสกดจำ/ไม่จำ */
  memorySuggestions?: MemorySuggestion[] | undefined;
}
