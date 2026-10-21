import type { PcmAudio } from '../features/voice/realtime/NativePcmAudio';
import { bytesToBase64, floatToPcm16Bytes } from '../features/voice/realtime/pcm';
import type { OnnxWakeModels } from '../features/voice/wakeword/OnnxWakeModels';
import {
  EnrollmentError,
  MIN_TEMPLATES,
  WINDOW_SIZE,
  buildTemplates,
  calibrate,
  decodeProfile,
  encodeProfile,
  negativeMaxOf,
  normalizeWindow,
  pickBestWindow,
  scoreWindow,
  templateModels,
  type ProfileStorage,
  type WakeProfile,
} from '../features/voice/wakeword/templates';
import { resolveWake, wakeConfig } from '../features/voice/wakeword/wakeConfig';
import { wakeSettings } from '../features/voice/wakeword/wakeSettings';
import {
  ChunkAssembler,
  WAKE_CHUNK,
  WAKE_MEL_WINDOW,
  WakeWordDetector,
  type WakeModels,
} from '../features/voice/wakeword/WakeWordDetector';
import { WakeWordService } from '../features/voice/wakeword/WakeWordService';

const chunk = (v = 0) => new Float32Array(WAKE_CHUNK).fill(v);
const flush = () => new Promise<void>((r) => setImmediate(r));

/** โมเดลปลอม: score ตามสคริปต์ · บันทึกสิ่งที่ถูกป้อนเข้ามา */
function scriptedModels(scores: number[]) {
  const seen = { melLengths: [] as number[], embedInputs: [] as Float32Array[] };
  let i = 0;
  const models: WakeModels = {
    mel: async (samples) => {
      seen.melLengths.push(samples.length);
      return new Float32Array(8 * 32); // ศูนย์ → หลัง /10+2 = 2
    },
    embed: async (mel) => {
      seen.embedInputs.push(mel.slice());
      return new Float32Array(96).fill(0.5);
    },
    score: async () => scores[Math.min(i++, scores.length - 1)] ?? 0,
  };
  return { models, seen };
}

describe('ChunkAssembler', () => {
  it('รวมตัวอย่างเป็นก้อน 1280 พอดี และเก็บเศษไว้รอ', () => {
    const a = new ChunkAssembler();
    expect(a.push(new Float32Array(1000))).toHaveLength(0);
    const out = a.push(new Float32Array(1560)); // 2560 รวม = 2 ก้อนพอดี
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.length === WAKE_CHUNK)).toBe(true);
    expect(a.push(new Float32Array(100))).toHaveLength(0);
    a.reset();
    expect(a.push(new Float32Array(WAKE_CHUNK))).toHaveLength(1);
  });

  it('ส่วนเกินข้ามก้อนไม่ตกหล่น (ค่าต่อเนื่องกัน)', () => {
    const a = new ChunkAssembler();
    a.push(Float32Array.from({ length: 1000 }, (_, i) => i));
    const [c] = a.push(Float32Array.from({ length: 400 }, (_, i) => 1000 + i));
    expect(c?.[0]).toBe(0);
    expect(c?.[1279]).toBe(1279);
  });
});

describe('WakeWordDetector', () => {
  it('ปฏิเสธก้อนที่ขนาดไม่ใช่ 1280', async () => {
    const d = new WakeWordDetector(scriptedModels([0]).models);
    await expect(d.pushChunk(new Float32Array(100))).rejects.toThrow('1280');
  });

  it('mel รับ 1760 ตัวอย่างล่าสุด · embed รับ 76 เฟรม × 32 ที่ผ่าน /10+2', async () => {
    const { models, seen } = scriptedModels([0]);
    const d = new WakeWordDetector(models);
    await d.pushChunk(chunk());
    await d.pushChunk(chunk());
    expect(seen.melLengths).toEqual([WAKE_CHUNK, WAKE_MEL_WINDOW]); // ก้อนแรกยังมีไม่ถึง 1760
    const last = seen.embedInputs.at(-1)!;
    expect(last).toHaveLength(76 * 32);
    expect(last[last.length - 1]).toBeCloseTo(2); // 0/10 + 2
  });

  it('ช่วงอุ่นเครื่อง 4 ก้อนแรกให้คะแนน 0 แม้โมเดลตอบสูง', async () => {
    const d = new WakeWordDetector(scriptedModels(Array(10).fill(0.99)).models, { patience: 1 });
    const scores: number[] = [];
    for (let i = 0; i < 6; i++) scores.push((await d.pushChunk(chunk())).score);
    expect(scores.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(scores[4]).toBeCloseTo(0.99);
  });

  it('ต้องผ่านเกณฑ์ติดกันตาม patience · ตกกลางทางแล้วนับใหม่', async () => {
    const warm = Array(4).fill(0);
    const d = new WakeWordDetector(scriptedModels([...warm, 0.9, 0.2, 0.9, 0.9]).models, {
      patience: 2,
      cooldownChunks: 0,
    });
    const triggered: boolean[] = [];
    for (let i = 0; i < 8; i++) triggered.push((await d.pushChunk(chunk())).triggered);
    expect(triggered).toEqual([false, false, false, false, false, false, false, true]);
  });

  it('หลังตรวจเจอ มี cooldown ไม่ยิงซ้ำ แล้วกลับมาตรวจได้', async () => {
    const warm = Array(4).fill(0);
    const d = new WakeWordDetector(scriptedModels([...warm, ...Array(12).fill(0.95)]).models, {
      patience: 1,
      cooldownChunks: 3,
    });
    const triggered: boolean[] = [];
    for (let i = 0; i < 12; i++) triggered.push((await d.pushChunk(chunk())).triggered);
    // ก้อนที่ 5 ยิง → ก้อน 6–8 cooldown → ก้อน 9 ยิงอีก
    expect(triggered.indexOf(true)).toBe(4);
    expect(triggered.slice(5, 8)).toEqual([false, false, false]);
    expect(triggered[8]).toBe(true);
  });

  it('reset ล้างสถานะ (ช่วงอุ่นเครื่องนับใหม่)', async () => {
    const d = new WakeWordDetector(scriptedModels(Array(20).fill(0.99)).models, { patience: 1 });
    for (let i = 0; i < 6; i++) await d.pushChunk(chunk());
    d.reset();
    expect((await d.pushChunk(chunk())).score).toBe(0);
  });
});

describe('templates', () => {
  const unit = (i: number) => {
    const v = new Float32Array(WINDOW_SIZE);
    v[i] = 1;
    return normalizeWindow(v);
  };

  it('normalizeWindow: เฉลี่ยศูนย์ ความยาวหน่วย · scoreWindow เทียบตัวเอง = 1', () => {
    const w = Float32Array.from({ length: WINDOW_SIZE }, (_, i) => Math.sin(i / 7) + 3);
    const n = normalizeWindow(w);
    expect(n.reduce((s, x) => s + x, 0) / n.length).toBeCloseTo(0, 5);
    expect(Math.hypot(...Array.from(n))).toBeCloseTo(1, 4);
    expect(scoreWindow([n], w)).toBeCloseTo(1, 4);
    expect(scoreWindow([], w)).toBe(0);
  });

  it('scoreWindow ใช้เทมเพลตที่ใกล้ที่สุด · ความดังไม่เปลี่ยนคะแนน', () => {
    const a = Float32Array.from({ length: WINDOW_SIZE }, (_, i) => Math.sin(i / 5));
    const b = Float32Array.from({ length: WINDOW_SIZE }, (_, i) => Math.cos(i / 11));
    const templates = [normalizeWindow(a), normalizeWindow(b)];
    expect(
      scoreWindow(
        templates,
        a.map((x) => x * 5 + 2),
      ),
    ).toBeCloseTo(1, 3);
    expect(scoreWindow(templates, b)).toBeCloseTo(1, 3);
  });

  it('pickBestWindow: เลือกหน้าต่างที่แปรปรวนสูงสุด · ทั้งหมดนิ่ง → null', () => {
    const flat = new Float32Array(WINDOW_SIZE).fill(0.4);
    const lively = Float32Array.from({ length: WINDOW_SIZE }, (_, i) => (i % 2 ? 1 : -1));
    expect(pickBestWindow([flat, lively, flat])).toBe(lively);
    expect(pickBestWindow([flat, flat])).toBeNull();
    expect(pickBestWindow([])).toBeNull();
  });

  it('calibrate: แยกชัด → เกณฑ์อยู่กลาง · ไม่ชัด → เหนือเสียงทั่วไปเล็กน้อย + เตือน', () => {
    const base = Float32Array.from({ length: WINDOW_SIZE }, (_, i) => Math.sin(i / 3));
    const noisy = (seed: number) =>
      normalizeWindow(base.map((x, i) => x + 0.15 * Math.sin(i * (seed + 1.3))));
    const templates = [noisy(1), noisy(2), noisy(3), noisy(4)];
    const clear = calibrate(templates, 0.3);
    expect(clear.separated).toBe(true);
    expect(clear.threshold).toBeGreaterThan(0.3);
    expect(clear.threshold).toBeLessThan(clear.positiveMin);
    const blurry = calibrate(templates, clear.positiveMin + 0.01);
    expect(blurry.separated).toBe(false);
    expect(blurry.threshold).toBeGreaterThan(clear.positiveMin);
    expect(blurry.threshold).toBeLessThanOrEqual(0.99);
  });

  /** โมเดลปลอม: embedding คงที่ = ระดับเสียงของก้อน (เงียบ → 0 → หน้าต่างนิ่ง) */
  const levelModels = {
    mel: async (s: Float32Array) => {
      let m = 0;
      for (const x of s) m += Math.abs(x);
      return new Float32Array(8 * 32).fill((m / s.length) * 10);
    },
    embed: async (mel: Float32Array) => new Float32Array(96).fill(mel[mel.length - 1] ?? 0),
  };
  const speechClip = (): Float32Array => {
    const out = new Float32Array(16000 * 3);
    for (let i = 16000; i < 32000; i++) out[i] = 8000 * Math.sin(i / 9);
    return out;
  };

  it('buildTemplates: เสียงพูดพอ → ได้เทมเพลต · เงียบ/สั้นเกิน → EnrollmentError', async () => {
    const ok = await buildTemplates(levelModels, Array.from({ length: MIN_TEMPLATES }, speechClip));
    expect(ok).toHaveLength(MIN_TEMPLATES);
    const silent = Array.from({ length: MIN_TEMPLATES }, () => new Float32Array(16000 * 3));
    await expect(buildTemplates(levelModels, silent)).rejects.toBeInstanceOf(EnrollmentError);
    await expect(buildTemplates(levelModels, [speechClip()])).rejects.toThrow('อย่างน้อย');
  });

  it('negativeMaxOf: คืนคะแนนสูงสุดในช่วง -1..1', async () => {
    const templates = await buildTemplates(
      levelModels,
      Array.from({ length: MIN_TEMPLATES }, speechClip),
    );
    const max = await negativeMaxOf(levelModels, templates, [
      speechClip(),
      new Float32Array(16000 * 2),
    ]);
    expect(max).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('templateModels: score ใช้เทมเพลต · mel/embed ส่งต่อโมเดลฐาน', async () => {
    const base = {
      mel: jest.fn(async () => new Float32Array(1)),
      embed: jest.fn(async () => new Float32Array(1)),
    };
    const t = unit(3);
    const models = templateModels(base, [t]);
    expect(await models.score(Float32Array.from(t))).toBeCloseTo(1, 4);
    await models.mel(new Float32Array(1));
    expect(base.mel).toHaveBeenCalledTimes(1);
  });

  it('encode/decode round trip + ปฏิเสธข้อมูลเสีย', () => {
    const profile: WakeProfile = { templates: [unit(1), unit(2)], threshold: 0.9, createdAt: 77 };
    const back = decodeProfile(encodeProfile(profile))!;
    expect(back.threshold).toBe(0.9);
    expect(back.createdAt).toBe(77);
    expect(back.templates).toHaveLength(2);
    expect(scoreWindow(back.templates, Float32Array.from(unit(2)))).toBeCloseTo(1, 4);
    expect(decodeProfile('xx')).toBeNull();
    expect(decodeProfile('{"v":2}')).toBeNull();
    expect(decodeProfile('{"v":1,"th":0.9,"w":["AAAA"]}')).toBeNull(); // ความยาวผิด
    expect(decodeProfile('{"v":1,"th":0.9,"w":[]}')).toBeNull();
  });
});

describe('WakeWordService', () => {
  const pcmChunk = (n: number) => bytesToBase64(floatToPcm16Bytes(new Float32Array(n).fill(0.1)));
  const fakeAudio = () => {
    let onMic: (b: string) => void = () => {};
    let stopped = 0;
    const audio: PcmAudio = {
      start: async (cb) => void (onMic = cb),
      play: () => {},
      clearPlayback: () => {},
      stop: async () => void stopped++,
    };
    return { audio, feed: (b: string) => onMic(b), stopped: () => stopped };
  };

  it('ป้อนเสียงจนคะแนนผ่านเกณฑ์ → เรียก onWake · onScore ถูกเรียกทุกก้อน', async () => {
    const { audio, feed } = fakeAudio();
    const scores: number[] = [];
    const service = new WakeWordService({
      audio: () => audio,
      models: scriptedModels([...Array(4).fill(0), 0.95, 0.95]).models,
      options: { patience: 2, cooldownChunks: 0 },
      onScore: (s) => scores.push(s),
    });
    const woke = jest.fn();
    await service.start(woke);
    for (let i = 0; i < 6; i++) feed(pcmChunk(1280));
    await flush();
    await flush();
    expect(scores).toHaveLength(6);
    expect(woke).toHaveBeenCalledTimes(1);
    await service.stop();
  });

  it('ก้อนเล็กกว่า 1280 ถูกประกอบก่อนประมวลผล · stop ปล่อยไมค์ + ไม่ประมวลผลต่อ', async () => {
    const { audio, feed, stopped } = fakeAudio();
    const scores: number[] = [];
    const service = new WakeWordService({
      audio: () => audio,
      models: scriptedModels([0]).models,
      onScore: (s) => scores.push(s),
    });
    await service.start(() => {});
    feed(pcmChunk(1024));
    await flush();
    expect(scores).toHaveLength(0);
    feed(pcmChunk(1024)); // รวม 2048 → 1 ก้อน
    await flush();
    expect(scores).toHaveLength(1);
    await service.stop();
    expect(stopped()).toBe(1);
    expect(service.isRunning).toBe(false);
    feed(pcmChunk(2560));
    await flush();
    expect(scores).toHaveLength(1);
  });

  it('start ซ้ำตอนทำงานอยู่ไม่เปิดไมค์ซ้อน · เปิดไมค์ไม่ได้ → throw และกลับสู่สถานะหยุด', async () => {
    const { audio } = fakeAudio();
    let starts = 0;
    const counting: PcmAudio = { ...audio, start: async (cb) => (starts++, audio.start(cb)) };
    const service = new WakeWordService({
      audio: () => counting,
      models: scriptedModels([0]).models,
    });
    await service.start(() => {});
    await service.start(() => {});
    expect(starts).toBe(1);
    await service.stop();

    const broken: PcmAudio = { ...audio, start: async () => Promise.reject(new Error('mic busy')) };
    const bad = new WakeWordService({ audio: () => broken, models: scriptedModels([0]).models });
    await expect(bad.start(() => {})).rejects.toThrow('mic busy');
    expect(bad.isRunning).toBe(false);
  });

  it('โมเดลพัง → ไม่ทำให้ล้ม แจ้ง onError', async () => {
    const { audio, feed } = fakeAudio();
    const errors: unknown[] = [];
    const models: WakeModels = {
      mel: async () => Promise.reject(new Error('ort failed')),
      embed: async () => new Float32Array(96),
      score: async () => 0,
    };
    const service = new WakeWordService({
      audio: () => audio,
      models,
      onError: (e) => errors.push(e),
    });
    await service.start(() => {});
    feed(pcmChunk(1280));
    await flush();
    await flush();
    expect(errors).toHaveLength(1);
    await service.stop();
  });
});

describe('wakeSettings: ประสานไมค์ + แจ้งการเปลี่ยน', () => {
  it('acquireMic นับซ้อนได้ · ปล่อยซ้ำไม่ติดลบ · แจ้งผู้ฟัง', () => {
    const calls: number[] = [];
    const off = wakeSettings.subscribe(() => calls.push(wakeSettings.isMicBusy() ? 1 : 0));
    expect(wakeSettings.isMicBusy()).toBe(false);
    const a = wakeSettings.acquireMic();
    const b = wakeSettings.acquireMic();
    a();
    a(); // ซ้ำ ไม่ทำอะไร
    expect(wakeSettings.isMicBusy()).toBe(true);
    b();
    expect(wakeSettings.isMicBusy()).toBe(false);
    expect(calls).toEqual([1, 1, 1, 0]);
    off();
  });

  it('เปิด/ปิดคำปลุกจำค่าและแจ้งผู้ฟัง', async () => {
    const seen: boolean[] = [];
    const off = wakeSettings.subscribe(
      () => void wakeSettings.isEnabled().then((v) => seen.push(v)),
    );
    await wakeSettings.setEnabled(true);
    expect(await wakeSettings.isEnabled()).toBe(true);
    await wakeSettings.setEnabled(false);
    await flush();
    expect(seen).toEqual([true, false]);
    off();
  });
});

describe('wakeConfig / resolveWake', () => {
  const memoryStorage = (
    initial: string | null = null,
  ): ProfileStorage & { value: string | null } => {
    const s = {
      value: initial,
      read: async () => s.value,
      write: async (t: string) => void (s.value = t),
      clear: async () => void (s.value = null),
    };
    return s;
  };
  const fakeBase = {
    mel: async () => new Float32Array(1),
    embed: async () => new Float32Array(1),
    score: async () => 0.7,
    warmUp: async () => {},
  };
  const profile = (threshold: number): WakeProfile => ({
    templates: [normalizeWindow(Float32Array.from({ length: WINDOW_SIZE }, (_, i) => Math.sin(i)))],
    threshold,
    createdAt: 1,
  });

  it('โหมด jarvis: ใช้โมเดลสำเร็จรูป + เกณฑ์ที่ปรับได้ (ค่าผิดปกติ → ค่าเริ่มต้น)', async () => {
    await wakeConfig.setMode('jarvis');
    const r = await resolveWake(fakeBase as unknown as OnnxWakeModels, memoryStorage());
    expect(r?.mode).toBe('jarvis');
    expect(r?.options.threshold).toBe(0.5);
    await wakeConfig.setJarvisThreshold(0.7);
    expect(
      (await resolveWake(fakeBase as unknown as OnnxWakeModels, memoryStorage()))?.options
        .threshold,
    ).toBe(0.7);
    await wakeConfig.setJarvisThreshold(5);
    expect(await wakeConfig.getJarvisThreshold()).toBe(0.5);
  });

  it('โหมด atom: ยังไม่ลงทะเบียน → null · ลงทะเบียนแล้วใช้เทมเพลต + เกณฑ์จากโปรไฟล์', async () => {
    await wakeConfig.setMode('atom');
    const empty = memoryStorage();
    expect(await resolveWake(fakeBase as unknown as OnnxWakeModels, empty)).toBeNull();
    const stored = memoryStorage(encodeProfile(profile(0.88)));
    const r = await resolveWake(fakeBase as unknown as OnnxWakeModels, stored);
    expect(r?.mode).toBe('atom');
    expect(r?.options.threshold).toBe(0.88);
    // ปรับเกณฑ์ภายหลัง → โหลดใหม่ได้ค่าใหม่ · ลบโปรไฟล์ → null
    await wakeConfig.setProfileThreshold(0.91, stored);
    expect(
      (await resolveWake(fakeBase as unknown as OnnxWakeModels, stored))?.options.threshold,
    ).toBe(0.91);
    await wakeConfig.clearProfile(stored);
    expect(await resolveWake(fakeBase as unknown as OnnxWakeModels, stored)).toBeNull();
  });
});
