/**
 * @file Speaker Gate — ตัดสินใจว่าเสียงไมค์ช่วงไหน "เป็นเสียงเจ้าของ" ก่อนส่งขึ้นเซิร์ฟเวอร์เสียงสด
 *
 * ไม่ใช่กุญแจความปลอดภัย (เสียงอัด/เสียงปลอมหลอกได้) — เป็นตัวกรองกันคนอื่น/ทีวีพูดแทรก และ **ไม่ส่งเสียงที่ไม่ใช่ของเรา
 * จึงไม่โดนคิดเงินโทเคนเสียง** · ความเงียบก็ไม่ส่ง (ประหยัดเพิ่ม)
 *
 * วงจรต่อช่วงพูด: idle → (เจอเสียงพูด) pending เก็บเสียงไว้ ~windowMs → verify กับโปรไฟล์ →
 *   ผ่าน: open ปล่อยเสียงที่เก็บไว้ (รวม pre-roll) แล้วส่งต่อจนเงียบ hangoverMs · ไม่ผ่าน: closed ทิ้งจนเงียบ
 * ต้องส่งความเงียบต่อท้าย hangoverMs ให้เซิร์ฟเวอร์ ไม่งั้น VAD ฝั่งเซิร์ฟเวอร์ไม่รู้ว่าพูดจบ
 * ค่าเวลาทั้งหมดคำนวณจากจำนวนตัวอย่าง (ไม่ใช้นาฬิกาจริง) → test ได้แน่นอน
 */

import { base64ToBytes, pcm16BytesToFloat } from '../realtime/pcm';
import { FBANK_SAMPLE_RATE } from './fbank';

export interface GateOptions {
  /** เก็บเสียงช่วงเริ่มพูดเท่านี้ก่อนตัดสิน (ms) — ยิ่งยาวยิ่งแม่น แต่เริ่มตอบช้าลง */
  windowMs: number;
  /** พูดสั้นกว่านี้แล้วหยุด = ไม่พอตัดสิน ทิ้ง (ms) */
  minMs: number;
  /** เงียบต่อเนื่องเท่านี้ = จบช่วงพูด (ms) · ต้อง ≥ silenceDurationMs ของ VAD ฝั่งเซิร์ฟเวอร์ */
  hangoverMs: number;
  /** เสียงก่อนจะเจอเสียงพูดที่แนบไปด้วย กันคำแรกขาด (ms) */
  prerollMs: number;
  /** RMS (0..1) ที่ถือว่าเป็นเสียงพูด */
  speechRms: number;
}

export const DEFAULT_GATE_OPTIONS: GateOptions = {
  windowMs: 1200,
  minMs: 500,
  hangoverMs: 800,
  prerollMs: 300,
  speechRms: 0.012,
};

export interface GateDeps {
  /** คะแนน cosine ของเสียงกับโปรไฟล์ (reject = ตรวจไม่ได้ → ปล่อยผ่านแล้วแจ้ง onError) */
  verify(samples: Float32Array): Promise<number>;
  send(base64Pcm: string): void;
  threshold: number;
  onDecision?(score: number, accepted: boolean): void;
  /** ตรวจเสียงไม่ได้ (เช่น โหลดโมเดลไม่สำเร็จ) — gate จะปล่อยเสียงผ่านทั้งหมดต่อไป */
  onError?(error: unknown): void;
}

interface Chunk {
  b64: string;
  samples: Float32Array;
  ms: number;
}

export type GateMode = 'idle' | 'pending' | 'open' | 'closed';

export class SpeakerGate {
  private mode: GateMode = 'idle';
  private preroll: Chunk[] = [];
  private prerollMs = 0;
  private buffer: Chunk[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private verifying = false;
  /** ช่วงพูดจบระหว่างรอผลตรวจ */
  private endedWhileVerifying = false;
  private failed = false;
  /** เพิ่มทุกครั้งที่เริ่มช่วงพูดใหม่/รีเซ็ต — ผลตรวจของช่วงเก่าที่มาช้าถูกทิ้ง */
  private epoch = 0;
  private readonly opts: GateOptions;

  constructor(
    private readonly deps: GateDeps,
    opts: Partial<GateOptions> = {},
  ) {
    this.opts = { ...DEFAULT_GATE_OPTIONS, ...opts };
  }

  getMode(): GateMode {
    return this.mode;
  }

  reset(): void {
    this.epoch++;
    this.mode = 'idle';
    this.preroll = [];
    this.prerollMs = 0;
    this.buffer = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.verifying = false;
    this.endedWhileVerifying = false;
  }

  /** ป้อนก้อนเสียงจากไมค์ (PCM16 16 kHz base64) */
  push(b64: string): void {
    if (this.failed) {
      this.deps.send(b64);
      return;
    }
    const samples = pcm16BytesToFloat(base64ToBytes(b64));
    const chunk: Chunk = { b64, samples, ms: (samples.length / FBANK_SAMPLE_RATE) * 1000 };
    const speech = rms(samples) >= this.opts.speechRms;

    switch (this.mode) {
      case 'idle':
        if (speech) this.beginSegment(chunk);
        else this.addPreroll(chunk);
        break;
      case 'pending':
        this.buffer.push(chunk);
        this.track(chunk, speech);
        if (this.silenceMs >= this.opts.hangoverMs) this.segmentEnded();
        else if (!this.verifying && this.speechMs >= this.opts.windowMs) this.decide();
        break;
      case 'open':
        this.deps.send(b64);
        this.track(chunk, speech);
        if (this.silenceMs >= this.opts.hangoverMs) this.toIdle();
        break;
      case 'closed':
        this.track(chunk, speech);
        if (this.silenceMs >= this.opts.hangoverMs) this.toIdle();
        break;
    }
  }

  private track(chunk: Chunk, speech: boolean) {
    if (speech) {
      this.speechMs += chunk.ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += chunk.ms;
    }
  }

  private addPreroll(chunk: Chunk) {
    this.preroll.push(chunk);
    this.prerollMs += chunk.ms;
    while (this.prerollMs > this.opts.prerollMs && this.preroll.length > 1) {
      const dropped = this.preroll.shift();
      this.prerollMs -= dropped?.ms ?? 0;
    }
  }

  private beginSegment(first: Chunk) {
    this.epoch++;
    this.mode = 'pending';
    this.buffer = [...this.preroll, first];
    this.preroll = [];
    this.prerollMs = 0;
    this.speechMs = first.ms;
    this.silenceMs = 0;
    this.verifying = false;
    this.endedWhileVerifying = false;
  }

  /** พูดจบ (เงียบเกิน hangover) ขณะยังเป็น pending */
  private segmentEnded() {
    if (this.verifying) {
      this.endedWhileVerifying = true;
      return;
    }
    if (this.speechMs >= this.opts.minMs) {
      this.endedWhileVerifying = true; // พูดจบแล้ว: ตัดสินเสร็จให้กลับ idle ไม่ใช่ open
      this.decide();
    } else {
      this.toIdle();
    }
  }

  private decide() {
    this.verifying = true;
    const epoch = this.epoch;
    const audio = concat(this.buffer.map((c) => c.samples));
    this.deps.verify(audio).then(
      (score) => {
        if (epoch !== this.epoch) return;
        this.verifying = false;
        const accepted = score >= this.deps.threshold;
        this.deps.onDecision?.(score, accepted);
        this.apply(accepted);
      },
      (error: unknown) => {
        if (epoch !== this.epoch) return;
        // ตรวจไม่ได้ → ปล่อยผ่านทั้งหมด (ผู้ใช้ไม่ถูกล็อกไม่ให้คุย) แล้วแจ้งให้รู้
        this.verifying = false;
        this.deps.onError?.(error);
        this.apply(true);
        this.failed = true;
      },
    );
  }

  private apply(accepted: boolean) {
    const ended = this.endedWhileVerifying;
    this.endedWhileVerifying = false;
    if (accepted) for (const c of this.buffer) this.deps.send(c.b64);
    this.buffer = [];
    if (ended) this.toIdle();
    else this.mode = accepted ? 'open' : 'closed';
  }

  private toIdle() {
    this.mode = 'idle';
    this.buffer = [];
    this.speechMs = 0;
    this.silenceMs = 0;
  }
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.sqrt(sum / samples.length);
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
