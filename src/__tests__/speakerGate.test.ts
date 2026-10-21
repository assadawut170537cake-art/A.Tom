import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import {
  GeminiLiveTransport,
  type SocketLike,
} from '../features/voice/realtime/GeminiLiveTransport';
import type { PcmAudio } from '../features/voice/realtime/NativePcmAudio';
import { buildRealtimeConfig } from '../features/voice/realtime/config';
import { bytesToBase64, floatToPcm16Bytes } from '../features/voice/realtime/pcm';
import {
  EMBEDDING_DIM,
  cosine,
  embedAudio,
  l2Normalize,
  meanEmbedding,
  type SpeakerModel,
} from '../features/voice/speaker/embedding';
import { SpeakerGate } from '../features/voice/speaker/gate';
import {
  DEFAULT_THRESHOLD,
  EnrollError,
  SpeakerProfileStore,
  buildProfile,
  decodeProfile,
  encodeProfile,
  keepVoiced,
} from '../features/voice/speaker/profile';
import {
  createSpeakerGate,
  enrollFromRecording,
  recordSamples,
} from '../features/voice/speaker/SpeakerService';

const CHUNK = 1024; // 64 ms @16k เท่าก้อนไมค์จริง

/** ก้อนเสียงคงที่ amplitude `amp` (บวก = "เจ้าของ", ลบ = "คนอื่น" ใน verify ปลอม) */
const chunk = (amp: number) => bytesToBase64(floatToPcm16Bytes(new Float32Array(CHUNK).fill(amp)));
const OWNER = chunk(0.2);
const STRANGER = chunk(-0.2);
const SILENCE = chunk(0);

/** verify ปลอม: ค่าเฉลี่ยเสียง > 0 = เจ้าของ */
const fakeVerify = async (samples: Float32Array) => {
  let sum = 0;
  for (const x of samples) sum += x;
  return sum > 0 ? 0.9 : 0.1;
};

function makeGate(overrides: Partial<ConstructorParameters<typeof SpeakerGate>[0]> = {}) {
  const sent: string[] = [];
  const decisions: [number, boolean][] = [];
  const errors: unknown[] = [];
  const verifyCalls: number[] = [];
  const gate = new SpeakerGate({
    verify: async (s) => {
      verifyCalls.push(s.length);
      return fakeVerify(s);
    },
    send: (b) => sent.push(b),
    threshold: 0.45,
    onDecision: (score, ok) => decisions.push([score, ok]),
    onError: (e) => errors.push(e),
    ...overrides,
  });
  return { gate, sent, decisions, errors, verifyCalls };
}

const feed = (gate: SpeakerGate, b64: string, n: number) => {
  for (let i = 0; i < n; i++) gate.push(b64);
};
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('SpeakerGate', () => {
  it('เงียบอย่างเดียว → ไม่ส่งอะไรเลย (ประหยัดโทเคน)', async () => {
    const { gate, sent, verifyCalls } = makeGate();
    feed(gate, SILENCE, 200);
    await flush();
    expect(sent).toEqual([]);
    expect(verifyCalls).toEqual([]);
  });

  it('เสียงเจ้าของ → ตัดสินเมื่อสะสมครบหน้าต่าง แล้วปล่อยทั้งก้อนที่เก็บไว้รวม pre-roll', async () => {
    const { gate, sent, decisions } = makeGate();
    feed(gate, SILENCE, 3); // ~192 ms ก่อนพูด (อยู่ใน pre-roll 300 ms)
    feed(gate, OWNER, 18);
    expect(sent).toEqual([]); // ยังไม่ครบ 1.2 วินาที
    gate.push(OWNER); // ก้อนที่ 19 = 1216 ms
    expect(gate.getMode()).toBe('pending');
    await flush();
    expect(decisions).toEqual([[0.9, true]]);
    expect(gate.getMode()).toBe('open');
    expect(sent.length).toBe(3 + 19); // pre-roll 3 + เสียงพูด 19 ก้อน
    expect(sent.slice(0, 3)).toEqual([SILENCE, SILENCE, SILENCE]);
    // พูดต่อ → ส่งต่อทันที
    gate.push(OWNER);
    expect(sent.length).toBe(23);
  });

  it('หลังพูดจบ ส่งความเงียบต่อท้าย hangover (ให้ VAD ฝั่งเซิร์ฟเวอร์รู้ว่าจบ) แล้วหยุดส่ง', async () => {
    const { gate, sent } = makeGate();
    feed(gate, OWNER, 25);
    await flush();
    const before = sent.length;
    feed(gate, SILENCE, 13); // 13×64 = 832 ms ≥ 800 ms
    expect(sent.length).toBe(before + 13);
    expect(gate.getMode()).toBe('idle');
    feed(gate, SILENCE, 20);
    expect(sent.length).toBe(before + 13); // เงียบต่อ = ไม่ส่งแล้ว
  });

  it('คนอื่นพูด → ไม่ส่งเลย จนเงียบ แล้วรอบหน้าเจ้าของพูดผ่านได้', async () => {
    const { gate, sent, decisions } = makeGate();
    feed(gate, STRANGER, 30);
    await flush();
    expect(decisions).toEqual([[0.1, false]]);
    expect(gate.getMode()).toBe('closed');
    feed(gate, STRANGER, 10);
    expect(sent).toEqual([]);
    feed(gate, SILENCE, 13);
    expect(gate.getMode()).toBe('idle');
    feed(gate, OWNER, 25);
    await flush();
    expect(gate.getMode()).toBe('open');
    expect(sent.length).toBeGreaterThan(0);
  });

  it('เสียงสั้นกว่า minMs (เช่น เสียงเคาะ/ไอ) → ทิ้ง ไม่ต้องตรวจ', async () => {
    const { gate, sent, verifyCalls } = makeGate();
    feed(gate, OWNER, 3); // 192 ms
    feed(gate, SILENCE, 14);
    await flush();
    expect(verifyCalls).toEqual([]);
    expect(sent).toEqual([]);
    expect(gate.getMode()).toBe('idle');
  });

  it('พูดสั้นแต่ถึง minMs (<หน้าต่าง) แล้วหยุด → ยังตรวจและปล่อยถ้าเป็นเจ้าของ', async () => {
    const { gate, sent } = makeGate();
    feed(gate, OWNER, 10); // 640 ms
    feed(gate, SILENCE, 13);
    await flush();
    expect(sent.length).toBe(10 + 13);
    expect(gate.getMode()).toBe('idle');
  });

  it('พูดจบระหว่างรอผลตรวจ → ผลมาแล้วปล่อยครบแล้วกลับ idle', async () => {
    let resolve: (n: number) => void = () => {};
    const { gate, sent } = makeGate({ verify: () => new Promise<number>((r) => (resolve = r)) });
    feed(gate, OWNER, 19); // ถึงหน้าต่าง → เริ่มตรวจ (ค้าง)
    feed(gate, SILENCE, 13); // เงียบจนจบช่วงพูดขณะรอ
    expect(sent).toEqual([]);
    resolve(0.9);
    await flush();
    expect(sent.length).toBe(19 + 13);
    expect(gate.getMode()).toBe('idle');
  });

  it('ตรวจไม่ได้ (verify พัง) → ปล่อยผ่านทั้งหมด ไม่ล็อกผู้ใช้ + แจ้ง onError', async () => {
    const { gate, sent, errors } = makeGate({
      verify: () => Promise.reject(new Error('model failed')),
    });
    feed(gate, OWNER, 19);
    await flush();
    expect(errors).toHaveLength(1);
    expect(sent.length).toBe(19);
    feed(gate, STRANGER, 5);
    feed(gate, SILENCE, 5);
    expect(sent.length).toBe(29); // ต่อจากนี้ทุกอย่างผ่านตรง ๆ
  });

  it('reset ระหว่างรอผลตรวจ → ผลเก่าที่มาช้าถูกทิ้ง', async () => {
    let resolve: (n: number) => void = () => {};
    const { gate, sent } = makeGate({ verify: () => new Promise<number>((r) => (resolve = r)) });
    feed(gate, OWNER, 19);
    gate.reset();
    resolve(0.9);
    await flush();
    expect(sent).toEqual([]);
    expect(gate.getMode()).toBe('idle');
  });
});

/** โมเดลปลอม: embedding เป็น one-hot ตามเลขลำดับการเรียก (mod k) */
const oneHotModel = (k: number): SpeakerModel => {
  let n = 0;
  return {
    embed: async () => {
      const v = new Float32Array(EMBEDDING_DIM);
      v[n++ % k] = 1;
      return v;
    },
  };
};
const constModel: SpeakerModel = {
  embed: async () => {
    const v = new Float32Array(EMBEDDING_DIM);
    v[0] = 1;
    v[1] = 0.05;
    return v;
  },
};
const tone = (seconds: number, amp = 0.1) => {
  const out = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / 16000);
  return out;
};

describe('embedding helpers', () => {
  it('cosine / normalize / mean', () => {
    const a = l2Normalize(
      Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 0 ? 3 : 0)),
    );
    const b = l2Normalize(
      Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 1 ? 5 : 0)),
    );
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, b)).toBeCloseTo(0);
    expect(cosine(meanEmbedding([a, b]), a)).toBeCloseTo(Math.SQRT1_2);
  });

  it('embedAudio: สั้นเกิน → null · ปกติ → normalized', async () => {
    expect(await embedAudio(constModel, tone(0.3))).toBeNull();
    const e = await embedAudio(constModel, tone(1));
    expect(e).not.toBeNull();
    expect(Math.hypot(...Array.from(e!))).toBeCloseTo(1);
  });
});

describe('profile', () => {
  it('encode/decode round trip + ปฏิเสธข้อมูลเสีย', () => {
    const embedding = l2Normalize(
      Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i)),
    );
    const raw = encodeProfile({ embedding, windows: 4, createdAt: 123 });
    const back = decodeProfile(raw)!;
    expect(back.windows).toBe(4);
    expect(back.createdAt).toBe(123);
    expect(cosine(back.embedding, embedding)).toBeCloseTo(1, 5);
    expect(decodeProfile('not json')).toBeNull();
    expect(decodeProfile('{"v":2}')).toBeNull();
    expect(decodeProfile('{"v":1,"e":"AAAA"}')).toBeNull(); // ความยาวผิด
  });

  it('keepVoiced ตัดความเงียบ', () => {
    const mixed = new Float32Array(16000 * 2);
    mixed.set(tone(1), 0); // วินาทีแรกมีเสียง วินาทีหลังเงียบ
    expect(keepVoiced(mixed).length).toBeGreaterThan(15000);
    expect(keepVoiced(mixed).length).toBeLessThan(16500);
    expect(keepVoiced(new Float32Array(16000)).length).toBe(0);
  });

  it('buildProfile: สำเร็จเมื่อเสียงนิ่งและยาวพอ', async () => {
    const { profile, consistency } = await buildProfile(constModel, tone(12), 42);
    expect(profile.windows).toBeGreaterThanOrEqual(2);
    expect(profile.createdAt).toBe(42);
    expect(consistency).toBeGreaterThan(0.99);
  });

  it('buildProfile: เสียงสั้นเกิน → EnrollError too_short', async () => {
    await expect(buildProfile(constModel, tone(3))).rejects.toMatchObject({ reason: 'too_short' });
    await expect(buildProfile(constModel, new Float32Array(16000 * 20))).rejects.toBeInstanceOf(
      EnrollError,
    );
  });

  it('buildProfile: เสียงไม่นิ่ง (หลายคน/เสียงรบกวน) → inconsistent', async () => {
    await expect(buildProfile(oneHotModel(7), tone(14))).rejects.toMatchObject({
      reason: 'inconsistent',
    });
  });

  it('store: บันทึก/โหลด/ล้าง · เปิดปิด · threshold ค่าเริ่มต้นและค่าผิดปกติ', async () => {
    const embedding = l2Normalize(
      Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.cos(i)),
    );
    await SpeakerProfileStore.save({ embedding, windows: 3, createdAt: 9 });
    expect((await SpeakerProfileStore.load())?.windows).toBe(3);
    expect(await SpeakerProfileStore.isEnabled()).toBe(false);
    await SpeakerProfileStore.setEnabled(true);
    expect(await SpeakerProfileStore.isEnabled()).toBe(true);
    expect(await SpeakerProfileStore.getThreshold()).toBe(DEFAULT_THRESHOLD);
    await SpeakerProfileStore.setThreshold(0.6);
    expect(await SpeakerProfileStore.getThreshold()).toBe(0.6);
    await SpeakerProfileStore.setThreshold(5);
    expect(await SpeakerProfileStore.getThreshold()).toBe(DEFAULT_THRESHOLD);
    await SpeakerProfileStore.clear();
    expect(await SpeakerProfileStore.load()).toBeNull();
    await SpeakerProfileStore.setEnabled(false);
  });
});

describe('SpeakerService', () => {
  afterEach(async () => {
    await SpeakerProfileStore.clear();
    await SpeakerProfileStore.setEnabled(false);
  });

  it('createSpeakerGate: ปิดอยู่/ยังไม่ลงทะเบียน → null', async () => {
    expect(await createSpeakerGate(() => {}, { model: constModel })).toBeNull();
    await SpeakerProfileStore.setEnabled(true);
    expect(await createSpeakerGate(() => {}, { model: constModel })).toBeNull(); // ไม่มีโปรไฟล์
  });

  it('enrollFromRecording → บันทึก + เปิดใช้ · gate ตัดสินด้วย cosine กับโปรไฟล์', async () => {
    await enrollFromRecording(tone(12), constModel);
    expect(await SpeakerProfileStore.isEnabled()).toBe(true);
    const sent: string[] = [];
    const gate = await createSpeakerGate((b) => sent.push(b), { model: constModel });
    expect(gate).not.toBeNull();
    feed(gate!, OWNER, 19); // โมเดลปลอมคืน embedding เดียวกันเสมอ → cosine = 1 → ผ่าน
    await flush();
    expect(gate!.getMode()).toBe('open');
    expect(sent.length).toBe(19);
  });

  it('โหลดโมเดลไม่ได้ → null (ปล่อยเสียงผ่าน ไม่ล็อกผู้ใช้)', async () => {
    await enrollFromRecording(tone(12), constModel);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { ...constModel, warmUp: () => Promise.reject(new Error('no model')) };
    expect(await createSpeakerGate(() => {}, { model: bad })).toBeNull();
    warn.mockRestore();
  });

  it('recordSamples: เก็บเสียงจนครบเวลาแล้วปิดไมค์', async () => {
    let onMic: (b: string) => void = () => {};
    let stopped = 0;
    const audio: PcmAudio = {
      start: async (cb) => void (onMic = cb),
      play: () => {},
      clearPlayback: () => {},
      stop: async () => void stopped++,
    };
    const progress: number[] = [];
    const promise = recordSamples(3, {
      audio,
      onProgress: (s) => progress.push(s),
      sleep: async () => void onMic(OWNER),
    });
    const samples = await promise;
    expect(progress).toEqual([1, 2, 3]);
    expect(samples.length).toBe(3 * CHUNK);
    expect(stopped).toBe(1);
  });
});

describe('GeminiLiveTransport + gate', () => {
  class Sock implements SocketLike {
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: ((e: { code?: number; reason?: string }) => void) | null = null;
    sent: Record<string, unknown>[] = [];
    constructor() {
      queueMicrotask(() => this.onopen?.());
    }
    send(d: string) {
      const m = JSON.parse(d) as Record<string, unknown>;
      this.sent.push(m);
      if (m.setup)
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }));
    }
    close() {}
  }

  afterEach(() => SecureKeyStore.delete(secretKey('ai', 'gemini')));

  it('เสียงไมค์ผ่าน gate ก่อนส่ง · close() รีเซ็ต gate', async () => {
    await SecureKeyStore.set(secretKey('ai', 'gemini'), 'AIzaTEST');
    let sock!: Sock; // สร้างตอน transport ขอ (onopen ต้องผูกก่อนไมโครทาสก์ของ constructor ทำงาน)
    let mic: (b: string) => void = () => {};
    const pushed: string[] = [];
    let resets = 0;
    let sendThroughGate: (b: string) => void = () => {};
    const fakeGate = {
      push: (b: string) => void pushed.push(b),
      reset: () => void resets++,
    } as unknown as SpeakerGate;
    const transport = new GeminiLiveTransport({
      socket: () => (sock = new Sock()),
      audio: () => ({
        start: async (cb) => void (mic = cb),
        play: () => {},
        clearPlayback: () => {},
        stop: async () => {},
      }),
      gate: async (send) => {
        sendThroughGate = send;
        return fakeGate;
      },
    });
    const events = new Proxy({}, { get: () => () => {} }) as never;
    await transport.connect(buildRealtimeConfig(1), events);

    mic('QUJD');
    expect(pushed).toEqual(['QUJD']);
    expect(sock.sent.some((m) => 'realtimeInput' in m)).toBe(false); // ยังไม่ออกจนกว่า gate จะปล่อย
    sendThroughGate('QUJD');
    expect(sock.sent.some((m) => 'realtimeInput' in m)).toBe(true);

    transport.close();
    expect(resets).toBe(1);
  });
});
