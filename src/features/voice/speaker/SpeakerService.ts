/**
 * @file ตัวเชื่อมระบบจำเสียงกับส่วนอื่นของแอป: สร้าง gate ให้เสียงสด · ลงทะเบียนเสียงจากการอัด
 *
 * จะกรองเสียงได้เฉพาะเส้นทางที่เราคุมเสียง PCM เอง (Gemini Live) — OpenAI/WebRTC กับตัวรู้จำเสียงของระบบ
 * ส่งเสียงออกไปเองโดยที่เราเข้าถึงเสียงดิบไม่ได้ จึงกรองไม่ได้
 */

import { NativePcmAudio, type PcmAudio } from '../realtime/NativePcmAudio';
import { base64ToBytes, pcm16BytesToFloat } from '../realtime/pcm';
import { cosine, embedAudio, type SpeakerModel } from './embedding';
import { SpeakerGate, type GateOptions } from './gate';
import { OnnxSpeakerModel, isOnnxAvailable, speakerModel } from './OnnxSpeakerModel';
import { SpeakerProfileStore, buildProfile, type EnrollResult } from './profile';

export interface SpeakerGateFactoryDeps {
  model?: SpeakerModel & { warmUp?(): Promise<void> };
  gateOptions?: Partial<GateOptions>;
}

/**
 * สร้าง gate สำหรับสายใหม่ — null = ไม่ต้องกรอง (ปิดอยู่ / ยังไม่ลงทะเบียน / ไม่มี native ONNX / โหลดโมเดลไม่ได้)
 * กรณีหลังสุด **ปล่อยผ่านแทนล็อกผู้ใช้** (ตัวกรองเป็นความสะดวก ไม่ใช่ระบบความปลอดภัย)
 */
export async function createSpeakerGate(
  send: (base64Pcm: string) => void,
  deps: SpeakerGateFactoryDeps = {},
): Promise<SpeakerGate | null> {
  if (!(await SpeakerProfileStore.isEnabled())) return null;
  const profile = await SpeakerProfileStore.load();
  if (!profile) return null;
  const model = deps.model ?? speakerModel;
  if (!deps.model && !isOnnxAvailable()) return null;
  try {
    await model.warmUp?.();
  } catch (e) {
    console.warn(
      '[speaker] โหลดโมเดลจำเสียงไม่สำเร็จ — ปล่อยเสียงผ่านโดยไม่กรอง',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  const threshold = await SpeakerProfileStore.getThreshold();
  return new SpeakerGate(
    {
      verify: async (samples) => {
        const e = await embedAudio(model, samples);
        return e ? cosine(e, profile.embedding) : 0;
      },
      send,
      threshold,
      onError: (e) =>
        console.warn('[speaker] ตรวจเสียงไม่ได้ — ปล่อยผ่าน', e instanceof Error ? e.message : e),
    },
    deps.gateOptions,
  );
}

/** อัดเสียงจากไมค์ `seconds` วินาที คืนตัวอย่าง 16 kHz mono (Float32) — ผู้เรียกต้องขอสิทธิ์ไมค์ก่อน */
export async function recordSamples(
  seconds: number,
  opts: {
    audio?: PcmAudio;
    onProgress?(elapsedSeconds: number): void;
    sleep?(ms: number): Promise<void>;
  } = {},
): Promise<Float32Array> {
  const audio = opts.audio ?? new NativePcmAudio();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunks: Float32Array[] = [];
  let total = 0;
  await audio.start((b64) => {
    const samples = pcm16BytesToFloat(base64ToBytes(b64));
    chunks.push(samples);
    total += samples.length;
  });
  try {
    for (let s = 1; s <= seconds; s++) {
      await sleep(1000);
      opts.onProgress?.(s);
    }
  } finally {
    await audio.stop();
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** สร้างโปรไฟล์จากเสียงที่อัด แล้วบันทึก + เปิดใช้งาน (throw EnrollError ถ้าเสียงสั้น/ไม่นิ่ง) */
export async function enrollFromRecording(
  recording: Float32Array,
  model: SpeakerModel = new OnnxSpeakerModel(),
): Promise<EnrollResult> {
  const result = await buildProfile(model, recording);
  await SpeakerProfileStore.save(result.profile);
  await SpeakerProfileStore.setEnabled(true);
  return result;
}

/** ข้อความให้ผู้ใช้อ่านตอนลงทะเบียน (พูดตามธรรมชาติ ~20 วินาที ประโยคหลากหลายเพื่อให้โปรไฟล์ครอบคลุม) */
export const ENROLL_PROMPT = [
  'สวัสดีครับ ผมกำลังสอนให้ผู้ช่วยจำเสียงของผม',
  'วันนี้อากาศดี ผมอยากออกไปเดินเล่นที่สวนสาธารณะตอนเย็น',
  'ช่วยเตือนผมพรุ่งนี้เช้าให้โทรหาหมอเรื่องนัดตรวจสุขภาพด้วยนะ',
  'เปิดไฟในห้องนั่งเล่น และปรับเสียงเพลงให้เบาลงหน่อย',
  'หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ',
].join('\n');
export const ENROLL_SECONDS = 20;
