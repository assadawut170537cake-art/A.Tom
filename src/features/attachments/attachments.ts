/**
 * @file เลือกไฟล์แนบ (ปุ่ม + บนหน้าหลัก) + อ่านเนื้อไฟล์ตอนส่งให้ AI
 *
 * - รูป: expo-image-picker (คลังรูป / กล้อง) · ไฟล์ทุกชนิด (รวมไฟล์โค้ด): expo-document-picker — Boss อนุมัติ 2026-10-20
 * - เก็บแค่ {@link AttachmentRef} ในแชท · อ่านเนื้อ ({@link readAttachment}) ตอนส่งเท่านั้น
 * - ไฟล์ใหญ่เกิน → ไม่ส่ง (Gemini รับ inline รวมไม่เกิน ~20 MB และ base64 ใหญ่ ๆ ทำให้แอปค้าง)
 */

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import {
  attachmentKind,
  type AttachmentData,
  type AttachmentRef,
} from '../../core/types/attachment';

/** ต่อไฟล์ (bytes) */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** ไฟล์ข้อความ/โค้ดยาวกว่านี้ตัดท้าย (กัน prompt ยาวจนโควต้าหมดในครั้งเดียว) */
export const MAX_TEXT_CHARS = 60_000;
/** แนบได้ครั้งละกี่ไฟล์ */
export const MAX_ATTACHMENTS = 5;

/** ผลของการเลือก: ไฟล์ที่ใช้ได้ + ข้อความไทยถ้ามีปัญหา (ไม่ throw) */
export interface PickResult {
  files: AttachmentRef[];
  error?: string | undefined;
}

const sizeError = (name: string) =>
  `ไฟล์ ${name} ใหญ่เกิน ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB — ส่งไฟล์ที่เล็กลง หรือส่งเป็นลิงก์แทน`;

function finish(files: AttachmentRef[]): PickResult {
  const tooBig = files.filter((f) => f.size !== undefined && f.size > MAX_ATTACHMENT_BYTES);
  const ok = files.filter((f) => !tooBig.includes(f));
  return { files: ok, ...(tooBig[0] && { error: sizeError(tooBig[0].name) }) };
}

function fromImageAssets(assets: ImagePicker.ImagePickerAsset[]): AttachmentRef[] {
  return assets.map((a, i) => {
    const name = a.fileName ?? `รูป-${Date.now()}-${i + 1}.jpg`;
    const mimeType = a.mimeType ?? 'image/jpeg';
    return { name, mimeType, kind: attachmentKind(name, mimeType), uri: a.uri, size: a.fileSize };
  });
}

/** เลือกรูปจากคลัง (หลายรูปได้) */
export async function pickImages(): Promise<PickResult> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS,
      // บีบไว้ก่อน: รูปจากกล้องมือถือ 5–10 MB ส่ง AI ช้าและเปลืองโควต้า ทั้งที่อ่านรายละเอียดได้เท่าเดิม
      quality: 0.7,
    });
    return res.canceled ? { files: [] } : finish(fromImageAssets(res.assets));
  } catch (e) {
    console.error('[attach] เลือกรูปไม่สำเร็จ', e);
    return { files: [], error: 'เปิดคลังรูปไม่ได้ — ตรวจสิทธิ์รูปภาพของแอปในตั้งค่าเครื่อง' };
  }
}

/** ถ่ายรูปใหม่ */
export async function takePhoto(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return {
        files: [],
        error: 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › สิทธิ์',
      };
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    return res.canceled ? { files: [] } : finish(fromImageAssets(res.assets));
  } catch (e) {
    console.error('[attach] ถ่ายรูปไม่สำเร็จ', e);
    return { files: [], error: 'เปิดกล้องไม่ได้ — ลองใหม่อีกครั้ง' };
  }
}

/** ไฟล์ทุกชนิด (เอกสาร / PDF / โค้ด / เสียง / วิดีโอ) */
export async function pickFiles(): Promise<PickResult> {
  try {
    // copyToCacheDirectory: ได้ file:// ที่อ่านได้แน่นอน (content:// ของบางแอปอ่านซ้ำทีหลังไม่ได้)
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return { files: [] };
    return finish(
      res.assets.slice(0, MAX_ATTACHMENTS).map((a) => {
        const mimeType = a.mimeType ?? 'application/octet-stream';
        return {
          name: a.name,
          mimeType,
          kind: attachmentKind(a.name, mimeType),
          uri: a.uri,
          size: a.size,
        };
      }),
    );
  } catch (e) {
    console.error('[attach] เลือกไฟล์ไม่สำเร็จ', e);
    return { files: [], error: 'เปิดตัวเลือกไฟล์ไม่ได้ — ลองใหม่อีกครั้ง' };
  }
}

/** mime ของไฟล์ข้อความที่ Android บอกไม่ได้ → text/plain (Gemini ไม่รับ octet-stream) */
const textMime = (ref: AttachmentRef) =>
  ref.mimeType.startsWith('text/') ? ref.mimeType : 'text/plain';

/**
 * อ่านเนื้อไฟล์ — คืน `null` = ส่งให้ AI ไม่ได้ (ชนิดที่ไม่รองรับ / ไฟล์หาย / ใหญ่เกิน) พร้อมเหตุผลใน `reason`
 */
export async function readAttachment(
  ref: AttachmentRef,
): Promise<{ data: AttachmentData | null; reason?: string }> {
  if (ref.kind === 'other') {
    return {
      data: null,
      reason: `ไฟล์ ${ref.name} เป็นชนิดที่ AI อ่านไม่ได้ (รองรับ: รูป · PDF · ข้อความ/โค้ด · เสียง · วิดีโอ)`,
    };
  }
  try {
    const file = new File(ref.uri);
    if (file.size > MAX_ATTACHMENT_BYTES) return { data: null, reason: sizeError(ref.name) };
    if (ref.kind === 'text') {
      const text = await file.text();
      const data =
        text.length > MAX_TEXT_CHARS
          ? `${text.slice(0, MAX_TEXT_CHARS)}\n… (ตัดท้ายเพราะยาวเกิน)`
          : text;
      return { data: { name: ref.name, mimeType: textMime(ref), kind: 'text', data } };
    }
    return {
      data: { name: ref.name, mimeType: ref.mimeType, kind: ref.kind, data: await file.base64() },
    };
  } catch (e) {
    console.error('[attach] อ่านไฟล์ไม่สำเร็จ', ref.name, e);
    return { data: null, reason: `อ่านไฟล์ ${ref.name} ไม่ได้ (อาจถูกลบไปแล้ว) — แนบใหม่อีกครั้ง` };
  }
}
