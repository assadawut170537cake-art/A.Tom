/**
 * @file แปลงเสียงที่ได้เป็น base64 → ไฟล์ที่ expo-audio เล่นได้ (ไม่ใช้ Buffer/atob เพราะไม่มีบนทุก runtime ของ RN)
 *
 * ใช้กับ Gemini TTS: รุ่น 2.5 / 3.1 ส่ง PCM ดิบ (`audio/L16;codec=pcm;rate=24000`, 16-bit little-endian mono)
 * ที่ไม่มี header → ต้องห่อด้วย WAV header ก่อนเล่น · รุ่น 3.8 ส่ง `audio/wav` มาพร้อม header แล้ว
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** base64 (มาตรฐานหรือ URL-safe, มี/ไม่มี padding) → bytes; อักขระอื่นถูกข้าม */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let length = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | (LOOKUP.get(char) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  return out.subarray(0, length);
}

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** อ่าน rate/channels จาก mime เช่น `audio/L16;codec=pcm;rate=24000` (ค่าเริ่มต้นตาม Gemini: 24 kHz mono 16-bit) */
export function pcmFormatFromMime(mimeType: string): PcmFormat {
  const param = (name: string, fallback: number) => {
    const value = Number(new RegExp(`(?:^|;)\\s*${name}=(\\d+)`, 'i').exec(mimeType)?.[1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return { sampleRate: param('rate', 24_000), channels: param('channels', 1), bitsPerSample: 16 };
}

/** PCM ดิบ → WAV (RIFF header 44 bytes + data) */
export function pcmToWav(pcm: Uint8Array, { sampleRate, channels, bitsPerSample }: PcmFormat): Uint8Array {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  header.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, true); // fmt chunk size (PCM)
  header.setUint16(20, 1, true); // audio format 1 = PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * blockAlign, true); // byte rate
  header.setUint16(32, blockAlign, true);
  header.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  header.setUint32(40, pcm.length, true);

  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header.buffer), 0);
  wav.set(pcm, 44);
  return wav;
}
