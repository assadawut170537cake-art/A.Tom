/**
 * @file ตัวช่วยเสียง PCM แบบ pure (ไม่แตะ native) — base64 ↔ bytes, Float32 ↔ Int16, นาฬิกาคิวเล่นเสียง
 *
 * Gemini Live รับ/ส่งเสียงเป็น PCM 16-bit little-endian mono ที่ห่อ base64 ใน JSON:
 * ขาเข้า 16 kHz · ขาออก 24 kHz — ไม่พึ่ง `Buffer` / `atob` (Hermes รุ่นต่าง ๆ ไม่เหมือนกัน) จึงเขียนเอง
 */

export const MIC_SAMPLE_RATE = 16_000;
export const PLAYBACK_SAMPLE_RATE = 24_000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4));
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '=';
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64_LOOKUP[clean.charAt(i)] ?? 0;
    const n1 = B64_LOOKUP[clean.charAt(i + 1)] ?? 0;
    const n2 = i + 2 < clean.length ? (B64_LOOKUP[clean.charAt(i + 2)] ?? 0) : -1;
    const n3 = i + 3 < clean.length ? (B64_LOOKUP[clean.charAt(i + 3)] ?? 0) : -1;
    out[o++] = (n0 << 2) | (n1 >> 4);
    if (n2 >= 0) out[o++] = ((n1 & 15) << 4) | (n2 >> 2);
    if (n3 >= 0) out[o++] = ((n2 & 3) << 6) | n3;
  }
  return out.subarray(0, o);
}

/** Float32 (-1..1) → PCM16 little-endian bytes (clamp กันเสียงแตก) */
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

/** PCM16 little-endian bytes → Float32 (-1..1) · byte เหลือเศษ 1 ตัว (ท้ายแพ็กเก็ตขาด) ถูกทิ้ง */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bytes[i * 2] ?? 0;
    const hi = bytes[i * 2 + 1] ?? 0;
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/**
 * นาฬิกาคิวเล่นเสียง: คำนวณว่าเสียงที่ป้อนเข้าคิวจะเล่นจบเมื่อไร โดยไม่ต้องรอ callback จาก native
 * ใช้ตัดสินใจ "ผู้ช่วยกำลังพูดอยู่ไหม" (ปิดไมค์กันเสียงสะท้อนเมื่อเล่นออกลำโพง) · now ส่งเข้ามาเพื่อ test ได้
 */
export class PlaybackClock {
  private endsAt = 0;

  constructor(private readonly sampleRate: number = PLAYBACK_SAMPLE_RATE) {}

  /** บันทึกว่าป้อนเสียง `samples` ตัวเข้าคิว ณ เวลา `now` (ms) */
  add(samples: number, now: number): void {
    const startAt = Math.max(this.endsAt, now);
    this.endsAt = startAt + (samples / this.sampleRate) * 1000;
  }

  /** ล้างคิว (ถูกพูดแทรก / หยุด) */
  reset(): void {
    this.endsAt = 0;
  }

  /** ยังมีเสียงค้างเล่นอยู่ (รวมช่วงหางอีก `tailMs` กันเสียงก้อง) */
  isActive(now: number, tailMs = 0): boolean {
    return now < this.endsAt + tailMs;
  }
}

/** UTF-8 bytes → string (ไม่พึ่ง TextDecoder — Gemini ส่ง JSON ที่มีภาษาไทยมาเป็นเฟรมไบนารี) */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      cp = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      cp = ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else if (b0 >= 0xf0) {
      cp =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    } else {
      cp = 0xfffd; // byte ต่อเนื่องที่โผล่มาลอย ๆ
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}
