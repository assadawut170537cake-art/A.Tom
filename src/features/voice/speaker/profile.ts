/**
 * @file โปรไฟล์เสียงของเจ้าของเครื่อง — เก็บเฉพาะเวกเตอร์ embedding (ไม่เก็บเสียงดิบ) ใน SecureStore
 * ข้อมูลชีวมิติ: ห้ามลง AsyncStorage / log / ซิงก์ขึ้นคลาวด์ · ค่าตั้ง (เปิด/ปิด, threshold) เป็น option ธรรมดา
 */

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { isRecord } from '../../../core/types/guards';
import { base64ToBytes, bytesToBase64 } from '../realtime/pcm';
import { EMBEDDING_DIM, cosine, embedAudio, meanEmbedding, type SpeakerModel } from './embedding';
import { FBANK_SAMPLE_RATE } from './fbank';

const PROFILE_KEY = secretKey('stt', 'speaker', 'profile');
const SCOPE = 'speaker';
/** cosine ขั้นต่ำที่ถือว่าเป็นเสียงเดียวกัน (WeSpeaker ResNet34: เสียงเดียวกัน ~0.5–0.8 · คนละคน <~0.3) */
export const DEFAULT_THRESHOLD = 0.45;
/** หน้าต่างที่ใช้สร้างโปรไฟล์ (วินาที) */
const ENROLL_WINDOW_S = 3;
const ENROLL_HOP_S = 1.5;
/** เสียงที่ดังกว่านี้ (RMS ต่อเฟรม 20ms) ถือว่าเป็นเสียงพูด */
const VOICED_RMS = 0.01;
/** ต้องมีเสียงพูดอย่างน้อยเท่านี้ (วินาที) ถึงสร้างโปรไฟล์ได้ */
export const MIN_ENROLL_VOICED_S = 6;
/** ความนิ่งของการอัดขั้นต่ำ (cosine ต่ำสุดของหน้าต่างเทียบค่าเฉลี่ย) */
export const MIN_CONSISTENCY = 0.5;

export interface SpeakerProfile {
  embedding: Float32Array;
  /** จำนวนหน้าต่างที่ใช้สร้าง */
  windows: number;
  createdAt: number;
}

export function encodeProfile(p: SpeakerProfile): string {
  const bytes = new Uint8Array(p.embedding.length * 4);
  const view = new DataView(bytes.buffer);
  p.embedding.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return JSON.stringify({ v: 1, e: bytesToBase64(bytes), w: p.windows, t: p.createdAt });
}

export function decodeProfile(raw: string): SpeakerProfile | null {
  try {
    const obj: unknown = JSON.parse(raw);
    if (!isRecord(obj) || obj.v !== 1 || typeof obj.e !== 'string') return null;
    const bytes = base64ToBytes(obj.e);
    if (bytes.length !== EMBEDDING_DIM * 4) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const embedding = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i] = view.getFloat32(i * 4, true);
    return {
      embedding,
      windows: typeof obj.w === 'number' ? obj.w : 0,
      createdAt: typeof obj.t === 'number' ? obj.t : 0,
    };
  } catch {
    return null;
  }
}

export const SpeakerProfileStore = {
  async load(): Promise<SpeakerProfile | null> {
    const raw = await SecureKeyStore.get(PROFILE_KEY);
    return raw ? decodeProfile(raw) : null;
  },
  save(profile: SpeakerProfile): Promise<void> {
    return SecureKeyStore.set(PROFILE_KEY, encodeProfile(profile));
  },
  clear(): Promise<void> {
    return SecureKeyStore.delete(PROFILE_KEY);
  },
  async isEnabled(): Promise<boolean> {
    return (await ProviderSettings.getOption(SCOPE, 'enabled')) === 'true';
  },
  setEnabled(enabled: boolean): Promise<void> {
    return ProviderSettings.setOption(SCOPE, 'enabled', String(enabled));
  },
  async getThreshold(): Promise<number> {
    const value = Number(await ProviderSettings.getOption(SCOPE, 'threshold'));
    return Number.isFinite(value) && value > 0 && value < 1 ? value : DEFAULT_THRESHOLD;
  },
  setThreshold(value: number): Promise<void> {
    return ProviderSettings.setOption(SCOPE, 'threshold', String(value));
  },
};

/** เก็บเฉพาะช่วงที่มีเสียงพูด (ตัดความเงียบ) เพื่อให้ embedding มาจากเสียงจริง */
export function keepVoiced(samples: Float32Array): Float32Array {
  const frame = Math.round(FBANK_SAMPLE_RATE * 0.02);
  const kept: Float32Array[] = [];
  let total = 0;
  for (let i = 0; i + frame <= samples.length; i += frame) {
    const chunk = samples.subarray(i, i + frame);
    let sum = 0;
    for (const x of chunk) sum += x * x;
    if (Math.sqrt(sum / frame) >= VOICED_RMS) {
      kept.push(chunk);
      total += frame;
    }
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const c of kept) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export interface EnrollResult {
  profile: SpeakerProfile;
  /** ค่า cosine ต่ำสุดระหว่างหน้าต่างกับค่าเฉลี่ย — ต่ำมาก = อัดไม่นิ่ง (มีคนอื่นพูดแทรก / เสียงรบกวน) */
  consistency: number;
}

export class EnrollError extends Error {
  constructor(
    readonly reason: 'too_short' | 'inconsistent',
    message: string,
  ) {
    super(message);
  }
}

/** เสียงที่อัดไว้ → โปรไฟล์ (throw EnrollError ถ้าเสียงสั้น/ไม่นิ่ง) */
export async function buildProfile(
  model: SpeakerModel,
  recording: Float32Array,
  now = Date.now(),
): Promise<EnrollResult> {
  const voiced = keepVoiced(recording);
  if (voiced.length < MIN_ENROLL_VOICED_S * FBANK_SAMPLE_RATE) {
    const got = (voiced.length / FBANK_SAMPLE_RATE).toFixed(1);
    throw new EnrollError(
      'too_short',
      `ต้องมีเสียงพูดอย่างน้อย ${MIN_ENROLL_VOICED_S} วินาที (ได้ ${got})`,
    );
  }
  const win = ENROLL_WINDOW_S * FBANK_SAMPLE_RATE;
  const hop = ENROLL_HOP_S * FBANK_SAMPLE_RATE;
  const embeddings: Float32Array[] = [];
  for (let start = 0; start + win <= voiced.length; start += hop) {
    const e = await embedAudio(model, voiced.subarray(start, start + win));
    if (e) embeddings.push(e);
  }
  if (embeddings.length < 2) {
    throw new EnrollError('too_short', 'เสียงสั้นเกินไปสำหรับสร้างโปรไฟล์ — พูดให้นานขึ้น');
  }
  const mean = meanEmbedding(embeddings);
  const consistency = Math.min(...embeddings.map((e) => cosine(e, mean)));
  if (consistency < MIN_CONSISTENCY) {
    throw new EnrollError(
      'inconsistent',
      'เสียงที่อัดไม่นิ่ง (อาจมีเสียงคนอื่น/เสียงรบกวน) — ลองอัดใหม่ในที่เงียบ',
    );
  }
  return { profile: { embedding: mean, windows: embeddings.length, createdAt: now }, consistency };
}
