/**
 * @file Kaldi-compatible log-mel filterbank (fbank) ใน TypeScript ล้วน — ฟีเจอร์ขาเข้าของโมเดลจำเสียง WeSpeaker
 *
 * ตรงกับ `torchaudio.compliance.kaldi.fbank(num_mel_bins=80, frame_length=25, frame_shift=10, dither=0,
 * sample_frequency=16000)` ที่ WeSpeaker ใช้ตอนเทรน: waveform ×32768 → snip_edges → ลบ DC → pre-emphasis 0.97 →
 * หน้าต่าง povey → FFT 512 → power → mel 80 bin (20 Hz–Nyquist) → log → ลบค่าเฉลี่ยรายมิติตามเวลา (CMN)
 * ตรวจเทียบกับตัวอ้างอิง Python ใน `scripts/speaker/ref_fbank.py` (ดู `speakerFbank.test.ts`)
 */

export const FBANK_SAMPLE_RATE = 16_000;
export const FBANK_MEL_BINS = 80;
const FRAME_LENGTH = 400; // 25 ms
const FRAME_SHIFT = 160; // 10 ms
const FFT_SIZE = 512;
const PREEMPHASIS = 0.97;
const LOW_FREQ = 20;
const LOG_FLOOR = 1.1920929e-7; // float32 epsilon (Kaldi)
const INT16_SCALE = 32768;

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

/** หน้าต่าง povey: (0.5 − 0.5·cos(2πn/(N−1)))^0.85 */
function poveyWindow(): Float64Array {
  const w = new Float64Array(FRAME_LENGTH);
  for (let n = 0; n < FRAME_LENGTH; n++) {
    w[n] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (FRAME_LENGTH - 1)), 0.85);
  }
  return w;
}

/** ตาราง mel filterbank [80][256] แบบ Kaldi (ไม่รวมบิน Nyquist) */
function melBank(): Float64Array[] {
  const numFft = FFT_SIZE / 2;
  const binWidth = FBANK_SAMPLE_RATE / FFT_SIZE;
  const melLow = mel(LOW_FREQ);
  const melHigh = mel(FBANK_SAMPLE_RATE / 2);
  const delta = (melHigh - melLow) / (FBANK_MEL_BINS + 1);
  const bank: Float64Array[] = [];
  for (let b = 0; b < FBANK_MEL_BINS; b++) {
    const left = melLow + b * delta;
    const center = melLow + (b + 1) * delta;
    const right = melLow + (b + 2) * delta;
    const weights = new Float64Array(numFft);
    for (let k = 0; k < numFft; k++) {
      const m = mel(binWidth * k);
      if (m > left && m < right)
        weights[k] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
    }
    bank.push(weights);
  }
  return bank;
}

const WINDOW = poveyWindow();
const BANK = melBank();

// ตาราง twiddle + bit-reverse ของ FFT 512
const COS = new Float64Array(FFT_SIZE / 2);
const SIN = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
  SIN[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
}
const REV = new Uint16Array(FFT_SIZE);
for (let i = 0, bits = Math.log2(FFT_SIZE); i < FFT_SIZE; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
  REV[i] = r;
}

/** FFT radix-2 ในที่ (re/im ยาว 512) */
function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = REV[i] ?? 0;
    if (j > i) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step] ?? 0;
        const wi = SIN[k * step] ?? 0;
        const a = start + k;
        const b = a + half;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/** จำนวนเฟรมที่ได้จากเสียง `samples` ตัว (snip_edges) */
export function frameCount(samples: number): number {
  return samples < FRAME_LENGTH ? 0 : 1 + Math.floor((samples - FRAME_LENGTH) / FRAME_SHIFT);
}

/**
 * เสียง mono 16 kHz (Float32, −1..1) → fbank ที่ทำ CMN แล้ว แบบ flatten [frames × 80] (row-major)
 * คืน null ถ้าเสียงสั้นกว่า 1 เฟรม
 */
export function computeFbank(samples: Float32Array): { data: Float32Array; frames: number } | null {
  const frames = frameCount(samples.length);
  if (frames === 0) return null;
  const out = new Float32Array(frames * FBANK_MEL_BINS);
  const frame = new Float64Array(FRAME_LENGTH);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < frames; f++) {
    const offset = f * FRAME_SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      frame[i] = (samples[offset + i] ?? 0) * INT16_SCALE;
      mean += frame[i] ?? 0;
    }
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i++) frame[i] = (frame[i] ?? 0) - mean;
    for (let i = FRAME_LENGTH - 1; i > 0; i--)
      frame[i] = (frame[i] ?? 0) - PREEMPHASIS * (frame[i - 1] ?? 0);
    frame[0] = (frame[0] ?? 0) - PREEMPHASIS * (frame[0] ?? 0);

    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME_LENGTH; i++) re[i] = (frame[i] ?? 0) * (WINDOW[i] ?? 0);
    fft(re, im);

    const power = new Float64Array(FFT_SIZE / 2);
    for (let k = 0; k < FFT_SIZE / 2; k++) power[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;

    for (let b = 0; b < FBANK_MEL_BINS; b++) {
      const weights = BANK[b] as Float64Array;
      let energy = 0;
      for (let k = 0; k < FFT_SIZE / 2; k++) energy += (weights[k] ?? 0) * (power[k] ?? 0);
      out[f * FBANK_MEL_BINS + b] = Math.log(Math.max(energy, LOG_FLOOR));
    }
  }

  // CMN: ลบค่าเฉลี่ยของแต่ละมิติตามเวลา
  for (let b = 0; b < FBANK_MEL_BINS; b++) {
    let sum = 0;
    for (let f = 0; f < frames; f++) sum += out[f * FBANK_MEL_BINS + b] ?? 0;
    const mean = sum / frames;
    for (let f = 0; f < frames; f++)
      out[f * FBANK_MEL_BINS + b] = (out[f * FBANK_MEL_BINS + b] ?? 0) - mean;
  }
  return { data: out, frames };
}
