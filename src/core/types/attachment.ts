/**
 * @file ไฟล์แนบในแชท (ปุ่ม + บนหน้าหลัก)
 *
 * - {@link AttachmentRef} = ที่เก็บในประวัติแชท: แค่ชื่อ/ชนิด/ที่อยู่ไฟล์ในเครื่อง (ไม่เก็บเนื้อไฟล์ — ประวัติจะบวม)
 * - {@link AttachmentData} = ตอนส่งให้ AI: อ่านเนื้อไฟล์แล้ว (base64 สำหรับรูป/PDF/สื่อ · ข้อความดิบสำหรับไฟล์ข้อความ/โค้ด)
 */

import { isNumber, isOneOf, isRecord, isString } from './guards';

/** image/pdf/media = ส่งเป็นไฟล์ (Gemini อ่านได้ตรง) · text = ไฟล์ข้อความ/โค้ด อ่านเป็นตัวอักษร · other = ส่งให้ AI ไม่ได้ */
export const ATTACHMENT_KINDS = ['image', 'pdf', 'text', 'media', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface AttachmentRef {
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  /** file:// หรือ content:// ในเครื่อง */
  uri: string;
  /** bytes (ตัวเลือกไฟล์บางตัวไม่บอก) */
  size?: number | undefined;
}

export interface AttachmentData {
  name: string;
  mimeType: string;
  kind: Exclude<AttachmentKind, 'other'>;
  /** kind = text → ข้อความดิบ · อื่น ๆ → base64 */
  data: string;
}

export function isAttachmentRef(value: unknown): value is AttachmentRef {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.mimeType) &&
    isString(value.uri) &&
    isOneOf(ATTACHMENT_KINDS, value.kind) &&
    (value.size === undefined || isNumber(value.size))
  );
}

/** นามสกุลที่เป็นข้อความ/โค้ด — ตัวเลือกไฟล์ของ Android มักบอก mime เป็น octet-stream สำหรับไฟล์พวกนี้ */
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|env\.example|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|sql|gradle|properties|lua|r|dart|vue|svelte|log)$/i;

/** เดาชนิดจาก mime + นามสกุล */
export function attachmentKind(name: string, mimeType: string): AttachmentKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  if (
    mime.startsWith('text/') ||
    /^application\/(json|xml|javascript|x-sh|x-python|sql|x-yaml|yaml|toml)/.test(mime) ||
    TEXT_EXT.test(name)
  ) {
    return 'text';
  }
  return 'other';
}
