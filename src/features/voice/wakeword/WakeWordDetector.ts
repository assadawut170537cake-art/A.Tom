/**
 * @file ตรวจคำปลุก "Hey Jarvis" แบบสตรีมบนเครื่อง (openWakeWord: melspectrogram → embedding → ตัวทำนาย) — พอร์ตจาก
 * `scripts/speaker/ref_wakeword.py` (ตรวจแล้วกับเสียง TTS: "Hey Jarvis" ได้ ~0.999, ประโยคอื่น ≤ 0.13)
 *
 * ทุก 1280 ตัวอย่าง (80 ms @16 kHz, ค่าระดับ int16 เป็น float):
 *   mel ของ 1760 ตัวอย่างล่าสุด (→ 8 เฟรม) → spec/10+2 → ต่อ mel buffer → embedding 96 มิติจาก 76 เฟรมล่าสุด →
 *   ต่อ feature buffer → ตัวทำนายอ่าน 16 embedding ล่าสุด → คะแนน 0..1
 * ตัวโมเดลอยู่หลัง `WakeModels` (ONNX จริงที่ OnnxWakeModels.ts) เพื่อให้ test ได้
 *
 * โมเดลที่เทรนไว้แล้วของ openWakeWord ใช้ได้เฉพาะงานไม่เชิงพาณิชย์ (CC BY-NC-SA 4.0)
 */

export const WAKE_CHUNK = 1280;
export const WAKE_MEL_WINDOW = WAKE_CHUNK + 480;
const MEL_BINS = 32;
const EMBED_FRAMES = 76;
const EMBED_DIM = 96;
const FEATURE_FRAMES = 16;
const MEL_BUFFER_MAX = 970;
const WARMUP_CHUNKS = 5;

export interface WakeModels {
  /** เสียง [samples] (ระดับ int16) → mel ดิบ flatten [frames × 32] */
  mel(samples: Float32Array): Promise<Float32Array>;
  /** mel 76 เฟรม flatten [76 × 32] (ผ่าน /10+2 แล้ว) → embedding [96] */
  embed(mel: Float32Array): Promise<Float32Array>;
  /** embedding 16 ชุด flatten [16 × 96] → คะแนนคำปลุก 0..1 */
  score(features: Float32Array): Promise<number>;
}

export interface WakeOptions {
  /** คะแนนขั้นต่ำที่ถือว่าได้ยินคำปลุก */
  threshold: number;
  /** ต้องผ่านเกณฑ์ติดกันกี่ช่วง (ช่วงละ 80 ms) กันเสียงรบกวนครั้งเดียว */
  patience: number;
  /** หลังตรวจเจอ ไม่ตรวจซ้ำกี่ช่วง */
  cooldownChunks: number;
}

export const DEFAULT_WAKE_OPTIONS: WakeOptions = {
  threshold: 0.5,
  patience: 2,
  cooldownChunks: 25,
};

export interface WakeResult {
  score: number;
  triggered: boolean;
}

/** ตัวประกอบก้อน: รับตัวอย่างขนาดใดก็ได้ ส่งออกเป็นก้อนละ 1280 ตัวอย่างพอดี */
export class ChunkAssembler {
  private pending = new Float32Array(0);

  push(samples: Float32Array): Float32Array[] {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    merged.set(samples, this.pending.length);
    const out: Float32Array[] = [];
    let offset = 0;
    while (merged.length - offset >= WAKE_CHUNK) {
      out.push(merged.slice(offset, offset + WAKE_CHUNK));
      offset += WAKE_CHUNK;
    }
    this.pending = merged.slice(offset);
    return out;
  }

  reset() {
    this.pending = new Float32Array(0);
  }
}

export class WakeWordDetector {
  private raw: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private mel: Float32Array<ArrayBufferLike> = new Float32Array(EMBED_FRAMES * MEL_BINS).fill(1);
  private features: Float32Array<ArrayBufferLike> = new Float32Array(FEATURE_FRAMES * EMBED_DIM);
  private chunks = 0;
  private streak = 0;
  private cooldown = 0;
  private readonly opts: WakeOptions;

  constructor(
    private readonly models: WakeModels,
    opts: Partial<WakeOptions> = {},
  ) {
    this.opts = { ...DEFAULT_WAKE_OPTIONS, ...opts };
  }

  reset(): void {
    this.raw = new Float32Array(0);
    this.mel = new Float32Array(EMBED_FRAMES * MEL_BINS).fill(1);
    this.features = new Float32Array(FEATURE_FRAMES * EMBED_DIM);
    this.chunks = 0;
    this.streak = 0;
    this.cooldown = 0;
  }

  /**
   * ป้อนก้อนเสียง 1280 ตัวอย่างพอดี (ค่าระดับ int16 เป็น float) แล้วคืนหน้าต่างฟีเจอร์ล่าสุด [16 × 96] flatten
   * (ใช้ทั้งตอนตรวจจับ และตอนลงทะเบียนคำปลุกของตัวเอง)
   */
  async pushChunkFeatures(chunk: Float32Array): Promise<Float32Array> {
    if (chunk.length !== WAKE_CHUNK)
      throw new Error(`ต้องป้อนก้อนละ ${WAKE_CHUNK} ตัวอย่าง (ได้ ${chunk.length})`);

    this.raw = tail(concat(this.raw, chunk), WAKE_MEL_WINDOW * 4);
    const rawMel = await this.models.mel(tail(this.raw, WAKE_MEL_WINDOW));
    const spec = new Float32Array(rawMel.length);
    for (let i = 0; i < rawMel.length; i++) spec[i] = (rawMel[i] ?? 0) / 10 + 2;
    this.mel = tail(concat(this.mel, spec), MEL_BUFFER_MAX * MEL_BINS);

    const embedding = await this.models.embed(tail(this.mel, EMBED_FRAMES * MEL_BINS));
    this.features = tail(concat(this.features, embedding), FEATURE_FRAMES * EMBED_DIM);
    this.chunks++;
    return this.features;
  }

  /** ป้อนก้อนเสียงแล้วตัดสินว่าได้ยินคำปลุกหรือยัง */
  async pushChunk(chunk: Float32Array): Promise<WakeResult> {
    const features = await this.pushChunkFeatures(chunk);
    const raw = await this.models.score(features);
    // openWakeWord ข้ามผลช่วงอุ่นเครื่อง (buffer ยังไม่เต็มด้วยเสียงจริง)
    const score = this.chunks < WARMUP_CHUNKS ? 0 : raw;

    if (this.cooldown > 0) {
      this.cooldown--;
      this.streak = 0;
      return { score, triggered: false };
    }
    this.streak = score >= this.opts.threshold ? this.streak + 1 : 0;
    if (this.streak >= this.opts.patience) {
      this.streak = 0;
      this.cooldown = this.opts.cooldownChunks;
      return { score, triggered: true };
    }
    return { score, triggered: false };
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function tail(a: Float32Array, n: number): Float32Array {
  return a.length <= n ? a : a.slice(a.length - n);
}
