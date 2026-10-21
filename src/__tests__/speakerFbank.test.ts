import golden from './fixtures/fbank_golden.json';
import { computeFbank, frameCount } from '../features/voice/speaker/fbank';

/** สัญญาณทดสอบเดียวกับ scripts/speaker/ref_fbank.py */
function testSignal(n = 8000): Float32Array {
  const out = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    out[t] =
      0.3 * Math.sin((2 * Math.PI * 440 * t) / 16000) +
      0.2 * Math.sin((2 * Math.PI * 1234 * t) / 16000) +
      0.05 * Math.sin(t * t * 1e-5);
  }
  return out;
}

describe('computeFbank (Kaldi-compatible)', () => {
  const result = computeFbank(testSignal());

  it('จำนวนเฟรมตรง snip_edges', () => {
    expect(result?.frames).toBe(golden.frames);
    expect(frameCount(8000)).toBe(golden.frames);
    expect(frameCount(399)).toBe(0);
    expect(frameCount(400)).toBe(1);
    expect(computeFbank(new Float32Array(300))).toBeNull();
  });

  const row = (i: number) => Array.from(result!.data.slice(i * 80, (i + 1) * 80));
  const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));

  it('ค่าตรงกับตัวอ้างอิง numpy (เฟรมแรก/กลาง/สุดท้าย)', () => {
    const frames = result!.frames;
    expect(maxDiff(row(0), golden.first)).toBeLessThan(2e-3);
    expect(maxDiff(row(Math.floor(frames / 2)), golden.mid)).toBeLessThan(2e-3);
    expect(maxDiff(row(frames - 1), golden.last)).toBeLessThan(2e-3);
  });

  it('CMN: ค่าเฉลี่ยรายมิติเป็นศูนย์', () => {
    for (let b = 0; b < 80; b++) {
      let sum = 0;
      for (let f = 0; f < result!.frames; f++) sum += result!.data[f * 80 + b]!;
      expect(Math.abs(sum / result!.frames)).toBeLessThan(1e-4);
    }
  });

  it('เงียบสนิทไม่ทำให้เป็น NaN/Infinity', () => {
    const silent = computeFbank(new Float32Array(16000))!;
    expect(Array.from(silent.data).every(Number.isFinite)).toBe(true);
  });
});
