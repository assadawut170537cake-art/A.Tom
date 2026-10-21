/**
 * @file ตั้งค่าคำปลุก + ตัวประกอบโมเดลตามโหมดที่เลือก
 *  - `atom`: "เฮ่ อะตอม" แบบเทมเพลตจากเสียงที่ลงทะเบียน (ต้องลงทะเบียนก่อน)
 *  - `jarvis`: "Hey Jarvis" โมเดลสำเร็จรูป (ใช้ได้ทันที ภาษาอังกฤษ)
 * ปรับได้ภายหลัง: เกณฑ์ (ความไว) ของแต่ละโหมด · ลงทะเบียน/ปรับเทียบใหม่ · ทดสอบสด
 */

import { File, Paths } from 'expo-file-system';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { recordSamples } from '../speaker/SpeakerService';
import { OnnxWakeModels } from './OnnxWakeModels';
import {
  DEFAULT_TEMPLATE_THRESHOLD,
  buildTemplates,
  calibrate,
  loadProfile,
  negativeMaxOf,
  saveProfile,
  templateModels,
  type Calibration,
  type ProfileStorage,
  type WakeProfile,
} from './templates';
import type { WakeModels, WakeOptions } from './WakeWordDetector';
import { wakeSettings } from './wakeSettings';

export type WakeMode = 'atom' | 'jarvis';
export const WAKE_PHRASES: Record<WakeMode, string> = { atom: 'เฮ่ อะตอม', jarvis: 'Hey Jarvis' };
export const DEFAULT_JARVIS_THRESHOLD = 0.5;
export const ENROLL_CLIPS = 6;
export const ENROLL_CLIP_SECONDS = 3;
export const CALIBRATE_SECONDS = 12;
const SCOPE = 'wakeword';

/** ไฟล์โปรไฟล์อยู่ในโฟลเดอร์ส่วนตัวของแอป (ไม่ใช่ที่เก็บ key) */
export const fileProfileStorage: ProfileStorage = {
  async read() {
    const file = new File(Paths.document, 'wake-profile.json');
    return file.exists ? await file.text() : null;
  },
  async write(text) {
    const file = new File(Paths.document, 'wake-profile.json');
    if (!file.exists) file.create();
    file.write(text);
  },
  async clear() {
    const file = new File(Paths.document, 'wake-profile.json');
    if (file.exists) file.delete();
  },
};

export const wakeConfig = {
  async getMode(): Promise<WakeMode> {
    return (await ProviderSettings.getOption(SCOPE, 'mode')) === 'jarvis' ? 'jarvis' : 'atom';
  },
  setMode: (mode: WakeMode) => ProviderSettings.setOption(SCOPE, 'mode', mode).then(notify),
  async getJarvisThreshold(): Promise<number> {
    const v = Number(await ProviderSettings.getOption(SCOPE, 'jarvisThreshold'));
    return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_JARVIS_THRESHOLD;
  },
  setJarvisThreshold: (v: number) =>
    ProviderSettings.setOption(SCOPE, 'jarvisThreshold', String(v)).then(notify),
  loadProfile: (storage: ProfileStorage = fileProfileStorage) => loadProfile(storage),
  async setProfileThreshold(
    threshold: number,
    storage: ProfileStorage = fileProfileStorage,
  ): Promise<void> {
    const p = await loadProfile(storage);
    if (p) {
      await saveProfile(storage, { ...p, threshold });
      notify();
    }
  },
  async clearProfile(storage: ProfileStorage = fileProfileStorage): Promise<void> {
    await storage.clear();
    notify();
  },
};

function notify(): void {
  wakeSettings.notify();
}

/** โมเดล+ตัวเลือกสำหรับโหมดที่เลือก · null = ยังใช้ไม่ได้ (โหมด atom แต่ยังไม่ลงทะเบียน) */
export async function resolveWake(
  base: OnnxWakeModels = new OnnxWakeModels(),
  storage: ProfileStorage = fileProfileStorage,
): Promise<{
  models: WakeModels & { warmUp?(): Promise<void> };
  options: Partial<WakeOptions>;
  mode: WakeMode;
} | null> {
  const mode = await wakeConfig.getMode();
  if (mode === 'jarvis') {
    return { models: base, options: { threshold: await wakeConfig.getJarvisThreshold() }, mode };
  }
  const profile = await loadProfile(storage);
  if (!profile) return null;
  const models = Object.assign(templateModels(base, profile.templates), {
    warmUp: () => base.warmUp(),
  });
  return { models, options: { threshold: profile.threshold }, mode };
}

/** อัดตัวอย่างคำปลุก `ENROLL_CLIPS` ครั้ง (แต่ละครั้ง 3 วินาที) → สร้างเทมเพลต (ผลยังไม่บันทึก จนกว่าจะปรับเทียบ) */
export async function enrollClips(
  base: Pick<WakeModels, 'mel' | 'embed'>,
  record: (seconds: number, index: number) => Promise<Float32Array> = (s) =>
    recordSamples(s).then(scaleToInt16),
): Promise<Float32Array[]> {
  const clips: Float32Array[] = [];
  for (let i = 0; i < ENROLL_CLIPS; i++) clips.push(await record(ENROLL_CLIP_SECONDS, i));
  return buildTemplates(base, clips);
}

/** อัดเสียงพูดทั่วไป (ไม่ใช่คำปลุก) แล้วตั้งเกณฑ์จากข้อมูลจริง → บันทึกโปรไฟล์ */
export async function calibrateAndSave(
  base: Pick<WakeModels, 'mel' | 'embed'>,
  templates: Float32Array[],
  record: (seconds: number) => Promise<Float32Array> = (s) => recordSamples(s).then(scaleToInt16),
  storage: ProfileStorage = fileProfileStorage,
  now = Date.now(),
): Promise<{ profile: WakeProfile; calibration: Calibration }> {
  const speech = await record(CALIBRATE_SECONDS);
  const calibration = calibrate(templates, await negativeMaxOf(base, templates, [speech]));
  const profile: WakeProfile = { templates, threshold: calibration.threshold, createdAt: now };
  await saveProfile(storage, profile);
  notify();
  return { profile, calibration };
}

/** recordSamples คืน -1..1 · โมเดล mel ต้องการค่าระดับ int16 */
export const scaleToInt16 = (x: Float32Array): Float32Array => x.map((v) => v * 32768);

export { DEFAULT_TEMPLATE_THRESHOLD };
