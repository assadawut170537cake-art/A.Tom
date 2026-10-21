/**
 * @file คำปลุกของตัวเอง ("เฮ่ อะตอม") แบบจับคู่เทมเพลตจากเสียงที่ลงทะเบียน — ไม่ต้องเทรนโมเดล
 *
 * ใช้ embedding ของ openWakeWord (หน้าต่าง 16 × 96 = ~1.3 วินาที) เป็นลายเซ็นของคำ: ลงทะเบียนหลายครั้ง → เก็บหน้าต่างที่
 * "มีเสียงพูดชัดที่สุด" ของแต่ละครั้งเป็นเทมเพลต · ตอนฟัง คะแนน = cosine สูงสุดกับเทมเพลตใด ๆ
 * **ความแม่นยำจริงต้องวัดกับเสียงของบอส** — ระบบจึงมีขั้น "ปรับเทียบ": ให้พูดประโยคทั่วไป (ไม่ใช่คำปลุก) แล้วตั้งเกณฑ์อยู่ระหว่าง
 * คะแนนต่ำสุดของคำปลุกกับคะแนนสูงสุดของประโยคทั่วไป + ปรับความไวภายหลังได้ + มีโหมดทดสอบสดดูคะแนนจริง
 */

import { isRecord } from '../../../core/types/guards';
import { base64ToBytes, bytesToBase64 } from '../realtime/pcm';
import { WAKE_CHUNK, WakeWordDetector, type WakeModels } from './WakeWordDetector';

export const WINDOW_SIZE = 16 * 96;
export const MIN_TEMPLATES = 4;
export const DEFAULT_TEMPLATE_THRESHOLD = 0.9;

/** ลบค่าเฉลี่ย + normalize เป็นหน่วย (ตัดผลของความดัง/ออฟเซ็ต) */
export function normalizeWindow(w: Float32Array): Float32Array {
  let mean = 0;
  for (const x of w) mean += x;
  mean /= w.length || 1;
  const out = new Float32Array(w.length);
  let norm = 0;
  for (let i = 0; i < w.length; i++) {
    const v = (w[i] ?? 0) - mean;
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / norm;
  return out;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

export interface WakeProfile {
  /** เทมเพลตที่ normalize แล้ว */
  templates: Float32Array[];
  threshold: number;
  createdAt: number;
}

/** คะแนน = cosine สูงสุดกับเทมเพลต (หน้าต่างเข้ามาแบบดิบ) */
export function scoreWindow(templates: readonly Float32Array[], window: Float32Array): number {
  if (templates.length === 0) return 0;
  const w = normalizeWindow(window);
  let best = -1;
  for (const t of templates) best = Math.max(best, dot(w, t));
  return Math.max(-1, Math.min(1, best));
}

/** หน้าต่างที่ "มีเสียงพูดชัดที่สุด" = ความแปรปรวนของ embedding สูงสุด (ความเงียบ → embedding นิ่ง) */
export function pickBestWindow(windows: readonly Float32Array[]): Float32Array | null {
  let best: Float32Array | null = null;
  let bestVar = 0;
  for (const w of windows) {
    let mean = 0;
    for (const x of w) mean += x;
    mean /= w.length || 1;
    let v = 0;
    for (const x of w) v += (x - mean) ** 2;
    v /= w.length || 1;
    if (v > bestVar) {
      bestVar = v;
      best = w;
    }
  }
  return best;
}

/** อุ่นเครื่องด้วยความเงียบก่อน (หน้าต่างฟีเจอร์เต็ม 16 ช่วง) — buffer เริ่มต้นไม่ใช่เสียงจริง จะทำให้ความเงียบดูเหมือนมีเสียงพูด */
const PRIME_CHUNKS = 20;

/** ป้อนเสียง (ค่าระดับ int16 เป็น float) ผ่าน pipeline ทีละ 1280 ตัวอย่าง คืนหน้าต่างฟีเจอร์ของทุกช่วงของเสียงนั้น */
export async function windowsOf(
  models: Pick<WakeModels, 'mel' | 'embed'>,
  samples: Float32Array,
): Promise<Float32Array[]> {
  const detector = new WakeWordDetector({ ...models, score: async () => 0 });
  const silence = new Float32Array(WAKE_CHUNK);
  for (let i = 0; i < PRIME_CHUNKS; i++) await detector.pushChunkFeatures(silence);
  const out: Float32Array[] = [];
  for (let i = 0; i + WAKE_CHUNK <= samples.length; i += WAKE_CHUNK) {
    out.push((await detector.pushChunkFeatures(samples.slice(i, i + WAKE_CHUNK))).slice());
  }
  return out;
}

export class EnrollmentError extends Error {}

/** เสียงที่อัดไว้หลายครั้ง (แต่ละครั้งพูดคำปลุก 1 ครั้ง) → เทมเพลต */
export async function buildTemplates(
  models: Pick<WakeModels, 'mel' | 'embed'>,
  recordings: readonly Float32Array[],
): Promise<Float32Array[]> {
  const templates: Float32Array[] = [];
  for (const rec of recordings) {
    const best = pickBestWindow(await windowsOf(models, rec));
    if (best) templates.push(normalizeWindow(best));
  }
  if (templates.length < MIN_TEMPLATES) {
    throw new EnrollmentError(
      `ได้เสียงที่ใช้ได้แค่ ${templates.length} ครั้ง ต้องอย่างน้อย ${MIN_TEMPLATES} — พูดให้ดังและชัดขึ้นแล้วลองใหม่`,
    );
  }
  return templates;
}

export interface Calibration {
  threshold: number;
  /** คะแนนต่ำสุดของคำปลุก (leave-one-out) */
  positiveMin: number;
  /** คะแนนสูงสุดของเสียงทั่วไป */
  negativeMax: number;
  /** false = คำปลุกกับเสียงทั่วไปแยกกันไม่ชัด (ควรลงทะเบียนใหม่ / ใช้หูฟังใกล้ปาก) */
  separated: boolean;
}

/**
 * ตั้งเกณฑ์จากข้อมูลจริง: positiveMin = ต่ำสุดของ (เทมเพลต i เทียบเทมเพลตอื่น) · negativeMax = สูงสุดของเสียงทั่วไปเทียบเทมเพลต
 * แยกชัด → เกณฑ์อยู่กลางระหว่างสอง · ไม่ชัด → เหนือเสียงทั่วไปเล็กน้อย (กันตื่นผิด) แล้วเตือนให้ลงทะเบียนใหม่
 */
export function calibrate(templates: readonly Float32Array[], negativeMax: number): Calibration {
  let positiveMin = 1;
  templates.forEach((t, i) => {
    const others = templates.filter((_, j) => j !== i);
    let best = -1;
    for (const o of others) best = Math.max(best, dot(t, o));
    positiveMin = Math.min(positiveMin, best);
  });
  const separated = positiveMin - negativeMax > 0.03;
  const threshold = separated
    ? (positiveMin + negativeMax) / 2
    : Math.min(0.99, negativeMax + 0.02);
  return {
    threshold: round(threshold),
    positiveMin: round(positiveMin),
    negativeMax: round(negativeMax),
    separated,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** คะแนนสูงสุดของเสียงทั่วไปเทียบเทมเพลต (ทุกหน้าต่างของทุกคลิป) */
export async function negativeMaxOf(
  models: Pick<WakeModels, 'mel' | 'embed'>,
  templates: readonly Float32Array[],
  recordings: readonly Float32Array[],
): Promise<number> {
  let max = -1;
  for (const rec of recordings) {
    for (const w of await windowsOf(models, rec)) max = Math.max(max, scoreWindow(templates, w));
  }
  return max;
}

/** ใช้เทมเพลตเป็นตัวให้คะแนนแทนโมเดลทำนายสำเร็จรูป */
export function templateModels(
  base: Pick<WakeModels, 'mel' | 'embed'>,
  templates: readonly Float32Array[],
): WakeModels {
  return {
    mel: base.mel.bind(base),
    embed: base.embed.bind(base),
    score: async (f) => scoreWindow(templates, f),
  };
}

// ---------- เก็บ/โหลดโปรไฟล์ ----------

export interface ProfileStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  clear(): Promise<void>;
}

export function encodeProfile(p: WakeProfile): string {
  return JSON.stringify({
    v: 1,
    th: p.threshold,
    t: p.createdAt,
    w: p.templates.map((tpl) => {
      const bytes = new Uint8Array(tpl.length * 4);
      const view = new DataView(bytes.buffer);
      tpl.forEach((x, i) => view.setFloat32(i * 4, x, true));
      return bytesToBase64(bytes);
    }),
  });
}

export function decodeProfile(raw: string): WakeProfile | null {
  try {
    const obj: unknown = JSON.parse(raw);
    if (!isRecord(obj) || obj.v !== 1 || !Array.isArray(obj.w) || typeof obj.th !== 'number')
      return null;
    const templates: Float32Array[] = [];
    for (const item of obj.w) {
      if (typeof item !== 'string') return null;
      const bytes = base64ToBytes(item);
      if (bytes.length !== WINDOW_SIZE * 4) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const tpl = new Float32Array(WINDOW_SIZE);
      for (let i = 0; i < WINDOW_SIZE; i++) tpl[i] = view.getFloat32(i * 4, true);
      templates.push(tpl);
    }
    if (templates.length === 0) return null;
    return { templates, threshold: obj.th, createdAt: typeof obj.t === 'number' ? obj.t : 0 };
  } catch {
    return null;
  }
}

export async function loadProfile(storage: ProfileStorage): Promise<WakeProfile | null> {
  const raw = await storage.read();
  return raw ? decodeProfile(raw) : null;
}

export function saveProfile(storage: ProfileStorage, profile: WakeProfile): Promise<void> {
  return storage.write(encodeProfile(profile));
}
