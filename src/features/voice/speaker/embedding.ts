/**
 * @file Speaker embedding: เสียง → fbank → โมเดล ONNX → เวกเตอร์ 256 มิติ (L2-normalized) + ตัวช่วยเปรียบเทียบ
 *
 * โมเดลจริงอยู่หลัง interface `SpeakerModel` (onnxruntime-react-native ที่ `OnnxSpeakerModel.ts`) เพื่อให้ test ได้
 */

import { FBANK_MEL_BINS, FBANK_SAMPLE_RATE, computeFbank } from './fbank';

export const EMBEDDING_DIM = 256;
/** เสียงสั้นกว่านี้ (0.5 วินาที) ไม่พอแยกตัวบุคคล */
export const MIN_EMBED_SAMPLES = FBANK_SAMPLE_RATE / 2;

export interface SpeakerModel {
  /** feats flatten [frames × 80] → embedding [256] (ยังไม่ normalize) */
  embed(feats: Float32Array, frames: number): Promise<Float32Array>;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** ค่าเฉลี่ยของหลาย embedding แล้ว normalize ใหม่ (ใช้เป็นโปรไฟล์เสียง) */
export function meanEmbedding(list: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(EMBEDDING_DIM);
  for (const e of list)
    for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = (out[i] ?? 0) + (e[i] ?? 0);
  return l2Normalize(out);
}

/** เสียง 16 kHz mono (Float32) → embedding ที่ normalize แล้ว · null = เสียงสั้นเกินไป */
export async function embedAudio(
  model: SpeakerModel,
  samples: Float32Array,
): Promise<Float32Array | null> {
  if (samples.length < MIN_EMBED_SAMPLES) return null;
  const fb = computeFbank(samples);
  if (!fb) return null;
  if (fb.data.length !== fb.frames * FBANK_MEL_BINS) return null;
  return l2Normalize(await model.embed(fb.data, fb.frames));
}
