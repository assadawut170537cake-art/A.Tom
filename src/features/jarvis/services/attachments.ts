/**
 * @file แนบรูป / ถ่ายรูป / แนบไฟล์ (PDF ฯลฯ) ให้ AI ดู
 *
 * ไฟล์ที่เลือกถูกคัดลอกไปไว้ `<document>/attachments/` เพราะไฟล์จากตัวเลือกอยู่ใน cache
 * ที่ระบบลบได้ — ประวัติแชทจะได้เปิดรูปเดิมได้ภายหลัง · อ่านเป็น base64 ตอนส่งเท่านั้น
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { Attachment } from '../../../core/types/message';
import type { AIAttachment } from '../../ai/core/types';

/** ใหญ่กว่านี้ส่งไม่ได้ (Gemini รับ inline รวมไม่เกิน ~20MB และ base64 ใหญ่ขึ้นอีก 1/3) */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** แนบได้สูงสุดต่อข้อความ */
export const MAX_ATTACHMENTS = 4;
/** คุณภาพ JPEG ของรูป — รูปจากกล้องมือถือใหญ่หลาย MB ลดลงแล้ว AI ยังอ่านได้ */
const IMAGE_QUALITY = 0.7;

export class AttachmentError extends Error {}

let counter = 0;
const newId = () => `att-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** คัดลอกไฟล์จากตัวเลือกมาเก็บในแอป — ไม่สำเร็จก็ใช้ไฟล์เดิม (ยังส่งได้ในรอบนี้) */
async function keep(uri: string, name: string): Promise<string> {
  try {
    const target = new File(attachmentsDir(), `${Date.now().toString(36)}-${name.replace(/[^\w.-]+/g, '_')}`);
    await new File(uri).copy(target);
    return target.uri;
  } catch (e) {
    console.error('[attachments] คัดลอกไฟล์แนบไม่ได้ — ใช้ไฟล์ชั่วคราวแทน', e);
    return uri;
  }
}

function checkSize(size: number | null | undefined, name: string) {
  if (size != null && size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(`ไฟล์ "${name}" ใหญ่เกิน 15MB — เลือกไฟล์ที่เล็กกว่านี้`);
  }
}

async function fromImageAsset(asset: ImagePicker.ImagePickerAsset): Promise<Attachment> {
  const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
  checkSize(asset.fileSize, name);
  return {
    id: newId(),
    kind: 'image',
    uri: await keep(asset.uri, name),
    mimeType: asset.mimeType ?? 'image/jpeg',
    name,
    size: asset.fileSize ?? null,
  };
}

/** เลือกรูปจากเครื่อง (ยกเลิก = null) */
export async function pickImage(): Promise<Attachment | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: IMAGE_QUALITY });
  const asset = res.canceled ? undefined : res.assets[0];
  return asset ? fromImageAsset(asset) : null;
}

/** ถ่ายรูปด้วยกล้อง (ยกเลิก = null · ไม่ได้สิทธิ์ = AttachmentError ภาษาไทย) */
export async function takePhoto(): Promise<Attachment | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AttachmentError('ยังไม่ได้อนุญาตให้ใช้กล้อง — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › สิทธิ์');
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: IMAGE_QUALITY });
  const asset = res.canceled ? undefined : res.assets[0];
  return asset ? fromImageAsset(asset) : null;
}

/** เลือกไฟล์ (PDF, ข้อความ, รูป) — Gemini อ่าน PDF ได้ทั้งเล่ม */
export async function pickDocument(): Promise<Attachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'text/*', 'image/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  checkSize(asset.size, asset.name);
  const mimeType = asset.mimeType ?? 'application/octet-stream';
  return {
    id: newId(),
    kind: mimeType.startsWith('image/') ? 'image' : 'file',
    uri: await keep(asset.uri, asset.name),
    mimeType,
    name: asset.name,
    size: asset.size ?? null,
  };
}

/** อ่านไฟล์แนบเป็น base64 สำหรับส่งให้ AI — ไฟล์หาย (ถูกลบ) = AttachmentError */
export async function toAIAttachment(att: Attachment): Promise<AIAttachment> {
  const file = new File(att.uri);
  if (!file.exists) throw new AttachmentError(`ไม่พบไฟล์แนบ "${att.name}" แล้ว — แนบใหม่อีกครั้ง`);
  return { mimeType: att.mimeType, data: await file.base64(), name: att.name };
}

/** ข้อความแทนไฟล์แนบในประวัติเก่า (ไม่ส่งไฟล์ซ้ำทุกรอบ — เปลือง token) */
export function describeAttachments(atts: Attachment[] | undefined): string {
  if (!atts?.length) return '';
  return atts.map((a) => `[แนบ${a.kind === 'image' ? 'รูป' : 'ไฟล์'}: ${a.name}]`).join(' ');
}
