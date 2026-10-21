import { ProviderError } from '../core/http/errors';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import {
  GeminiLiveTransport,
  buildGeminiSetup,
  parseFrame,
  type SocketLike,
} from '../features/voice/realtime/GeminiLiveTransport';
import type { PcmAudio } from '../features/voice/realtime/NativePcmAudio';
import {
  PlaybackClock,
  base64ToBytes,
  bytesToBase64,
  floatToPcm16Bytes,
  pcm16BytesToFloat,
  utf8Decode,
} from '../features/voice/realtime/pcm';
import { buildRealtimeConfig } from '../features/voice/realtime/config';
import { RoutedTransport, pickRealtimeProvider } from '../features/voice/realtime/registry';
import type {
  RealtimeEvents,
  RealtimeProvider,
  RealtimeTransport,
} from '../features/voice/realtime/types';

describe('pcm helpers', () => {
  it('base64: เวกเตอร์มาตรฐาน + round trip ทุกความยาว', () => {
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(bytesToBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(bytesToBase64(new Uint8Array([77]))).toBe('TQ==');
    for (let n = 0; n < 12; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('Float32 ↔ PCM16: round trip, clamp, endian', () => {
    const bytes = floatToPcm16Bytes(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
    const back = pcm16BytesToFloat(bytes);
    expect(back[0]).toBe(0);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[3]).toBeCloseTo(1, 3);
    expect(back[4]).toBe(-1);
    expect(back[5]).toBeCloseTo(1, 3); // clamp
    expect(back[6]).toBe(-1); // clamp
    expect(Array.from(floatToPcm16Bytes(new Float32Array([1])))).toEqual([0xff, 0x7f]); // little-endian
  });

  it('PCM16 byte คี่ (แพ็กเก็ตขาด) → ทิ้ง byte เศษ', () => {
    expect(pcm16BytesToFloat(new Uint8Array([0, 0, 1])).length).toBe(1);
  });

  it('utf8Decode: ภาษาไทย + emoji', () => {
    const text = 'สวัสดีครับบอส 😀';
    const bytes = Uint8Array.from(Buffer.from(text, 'utf8'));
    expect(utf8Decode(bytes)).toBe(text);
  });

  it('PlaybackClock: คิวต่อเนื่อง · tail · reset', () => {
    const clock = new PlaybackClock(24_000);
    clock.add(24_000, 1000); // 1 วินาที
    clock.add(12_000, 1100); // ต่อท้ายคิว +0.5 วินาที
    expect(clock.isActive(2400)).toBe(true);
    expect(clock.isActive(2600)).toBe(false);
    expect(clock.isActive(2600, 200)).toBe(true); // ช่วงหาง
    clock.reset();
    expect(clock.isActive(1200)).toBe(false);
  });
});

describe('buildGeminiSetup / parseFrame', () => {
  const config = buildRealtimeConfig(1);

  it('setup: model, เสียง, tool NON_BLOCKING, VAD, transcription', () => {
    const { setup } = buildGeminiSetup(config, 'gemini-3.8-live', { extras: false }) as {
      setup: Record<string, any>;
    };
    expect(setup.model).toBe('models/gemini-3.8-live');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Fenrir',
    ); // ash → Fenrir
    expect(setup.tools[0].functionDeclarations[0].behavior).toBe('NON_BLOCKING');
    expect(setup.realtimeInputConfig.activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS');
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.contextWindowCompression).toBeUndefined();
    expect(setup.tools).toHaveLength(1); // ไม่มี googleSearch เมื่อไม่ใช้ extras
    expect(setup.sessionResumption).toBeUndefined();
  });

  it('extras: บีบ context + resumption (พร้อม handle)', () => {
    const { setup } = buildGeminiSetup(config, 'm', { extras: true, handle: 'h1' }) as {
      setup: Record<string, any>;
    };
    expect(setup.contextWindowCompression.triggerTokens).toBeGreaterThan(
      setup.contextWindowCompression.slidingWindow.targetTokens,
    );
    expect(setup.sessionResumption).toEqual({ handle: 'h1' });
    expect(setup.tools[1]).toEqual({ googleSearch: {} });
    const fresh = buildGeminiSetup(config, 'm', { extras: true }) as { setup: Record<string, any> };
    expect(fresh.setup.sessionResumption).toEqual({});
  });

  it('parseFrame: string / ArrayBuffer ไทย / ขยะ', () => {
    expect(parseFrame('{"a":1}')).toEqual({ a: 1 });
    const buf = Buffer.from(JSON.stringify({ t: 'ทดสอบ' }), 'utf8');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    expect(parseFrame(ab)).toEqual({ t: 'ทดสอบ' });
    expect(parseFrame('not json')).toBeNull();
    expect(parseFrame(42)).toBeNull();
    expect(parseFrame('[1]')).toBeNull();
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null = null;
  sent: Record<string, any>[] = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly onSetup: (s: FakeSocket) => void,
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: string) {
    const msg = JSON.parse(data) as Record<string, any>;
    this.sent.push(msg);
    if (msg.setup) this.onSetup(this);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  serverSays(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  dropped(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

class FakeAudio implements PcmAudio {
  played: string[] = [];
  cleared = 0;
  stopped = 0;
  onMic: ((b64: string) => void) | null = null;
  startError: Error | null = null;
  async start(onMic: (b64: string) => void) {
    if (this.startError) throw this.startError;
    this.onMic = onMic;
  }
  play(b64: string) {
    this.played.push(b64);
  }
  clearPlayback() {
    this.cleared++;
  }
  async stop() {
    this.stopped++;
  }
}

function makeEvents() {
  const log: string[] = [];
  const events: RealtimeEvents = {
    onSpeechStarted: () => log.push('speech'),
    onUserTranscript: (t) => log.push(`user:${t}`),
    onResponseStarted: () => log.push('started'),
    onAssistantTranscript: (t) => log.push(`assistant:${t}`),
    onResponseDone: (i) => log.push(`done:${i.hadToolCall}`),
    onToolCall: (c) => log.push(`tool:${c.name}:${c.args}`),
    onError: (e) => log.push(`error:${e.message}`),
    onClosed: () => log.push('closed'),
  };
  return { log, events };
}

type Behavior = (socket: FakeSocket, index: number) => void;
const okSetup: Behavior = (s) => queueMicrotask(() => s.serverSays({ setupComplete: {} }));

async function setup(behavior: Behavior = okSetup) {
  await SecureKeyStore.set(secretKey('ai', 'gemini'), 'AIzaTESTKEY');
  const sockets: FakeSocket[] = [];
  const audio = new FakeAudio();
  const transport = new GeminiLiveTransport({
    audio: () => audio,
    socket: (url) => {
      const index = sockets.length;
      const s = new FakeSocket(url, (sock) => behavior(sock, index));
      sockets.push(s);
      return s;
    },
  });
  const { log, events } = makeEvents();
  return { transport, sockets, audio, log, events };
}

const flush = () => new Promise<void>((r) => setImmediate(r));
const config = buildRealtimeConfig(2);

describe('GeminiLiveTransport', () => {
  afterEach(async () => {
    await SecureKeyStore.delete(secretKey('ai', 'gemini'));
    await SecureKeyStore.delete(secretKey('tts', 'gemini'));
  });

  it('connect: ส่ง setup เป็นข้อความแรก · ไมค์ถูกส่งเป็น realtimeInput', async () => {
    const { transport, sockets, audio, events } = await setup();
    await transport.connect(config, events);
    expect(sockets[0]?.url).toContain('BidiGenerateContent?key=');
    expect(Object.keys(sockets[0]?.sent[0] ?? {})).toEqual(['setup']);
    audio.onMic?.('QUJD');
    expect(sockets[0]?.sent[1]).toEqual({
      realtimeInput: { audio: { data: 'QUJD', mimeType: 'audio/pcm;rate=16000' } },
    });
  });

  it('ไม่มี key → missing_key', async () => {
    const { transport, events } = await setup();
    await SecureKeyStore.delete(secretKey('ai', 'gemini'));
    await expect(transport.connect(config, events)).rejects.toMatchObject({ kind: 'missing_key' });
  });

  it('ใช้ key Gemini TTS เป็นตัวสำรอง', async () => {
    const { transport, events } = await setup();
    await SecureKeyStore.delete(secretKey('ai', 'gemini'));
    await SecureKeyStore.set(secretKey('tts', 'gemini'), 'AIzaTTS');
    await expect(transport.connect(config, events)).resolves.toBeUndefined();
  });

  it('key ผิด (ปิดสายก่อน setupComplete) → auth', async () => {
    const { transport, events } = await setup((s) =>
      queueMicrotask(() => s.dropped(1008, 'API key not valid')),
    );
    await expect(transport.connect(config, events)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('setup เสริมถูกปฏิเสธ → ลองใหม่แบบเรียบ (ไม่มี compression/resumption)', async () => {
    const { transport, sockets, events } = await setup((s, i) =>
      i === 0
        ? queueMicrotask(() => s.dropped(1007, 'Invalid JSON payload: contextWindowCompression'))
        : okSetup(s, i),
    );
    await transport.connect(config, events);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.sent[0]?.setup.contextWindowCompression).toBeDefined();
    expect(sockets[1]?.sent[0]?.setup.contextWindowCompression).toBeUndefined();
  });

  it('เทิร์นปกติ: transcript สะสมเป็นชิ้น → ส่งครั้งเดียวเมื่อจบ · เสียงเข้าคิวเล่น · ลำดับ event ถูก', async () => {
    const { transport, sockets, audio, log, events } = await setup();
    await transport.connect(config, events);
    const ws = sockets[0]!;
    ws.serverSays({ serverContent: { inputTranscription: { text: 'สวัสดี' } } });
    ws.serverSays({ serverContent: { inputTranscription: { text: 'ครับ' } } });
    ws.serverSays({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] },
      },
    });
    ws.serverSays({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'BBB=' } }] },
        outputTranscription: { text: 'สวัสดี' },
      },
    });
    ws.serverSays({ serverContent: { outputTranscription: { text: 'ครับบอส' } } });
    ws.serverSays({ serverContent: { turnComplete: true } });
    expect(audio.played).toEqual(['AAA=', 'BBB=']);
    expect(log).toEqual([
      'speech',
      'started',
      'user:สวัสดีครับ',
      'assistant:สวัสดีครับบอส',
      'done:false',
    ]);
  });

  it('พูดแทรก (interrupted) → ล้างคิวเสียง + แจ้ง speech + ปิดคำตอบที่ค้าง', async () => {
    const { transport, sockets, audio, log, events } = await setup();
    await transport.connect(config, events);
    const ws = sockets[0]!;
    ws.serverSays({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }] },
        outputTranscription: { text: 'กำลังพูด' },
      },
    });
    ws.serverSays({ serverContent: { interrupted: true } });
    expect(audio.cleared).toBe(1);
    expect(log).toEqual(['started', 'assistant:กำลังพูด', 'done:false', 'speech']);
  });

  it('tool call: ส่งต่อ event · ตอบกลับด้วยชื่อ tool + scheduling · เทิร์น tool ล้วนไม่ส่ง transcript ซ้ำ', async () => {
    const { transport, sockets, log, events } = await setup();
    await transport.connect(config, events);
    const ws = sockets[0]!;
    ws.serverSays({ serverContent: { inputTranscription: { text: 'จดโน้ต' } } });
    ws.serverSays({
      toolCall: { functionCalls: [{ id: 'f1', name: 'ask_atom', args: { request: 'จดโน้ต' } }] },
    });
    ws.serverSays({ serverContent: { turnComplete: true } });
    expect(log).toEqual(['speech', 'tool:ask_atom:{"request":"จดโน้ต"}']); // ไม่มี started/user/done
    transport.sendToolResult('f1', 'จดแล้ว');
    expect(ws.sent.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [
          { id: 'f1', name: 'ask_atom', response: { output: 'จดแล้ว' }, scheduling: 'WHEN_IDLE' },
        ],
      },
    });
    // คำตอบหลังได้ผล: เริ่มรอบใหม่ ไม่มี transcript ผู้ใช้ซ้ำ
    ws.serverSays({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }] },
        outputTranscription: { text: 'จดแล้วครับ' },
      },
    });
    ws.serverSays({ serverContent: { turnComplete: true } });
    expect(log.slice(2)).toEqual(['started', 'assistant:จดแล้วครับ', 'done:false']);
  });

  it('goAway + มี handle → ต่อสายใหม่พร้อม resumption handle แล้วปิดสายเก่า', async () => {
    const { transport, sockets, events } = await setup();
    await transport.connect(config, events);
    const first = sockets[0]!;
    first.serverSays({ sessionResumptionUpdate: { resumable: true, newHandle: 'H-123' } });
    first.serverSays({ goAway: { timeLeft: '30s' } });
    await flush();
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.sent[0]?.setup.sessionResumption).toEqual({ handle: 'H-123' });
    expect(first.closed).toBe(true);
  });

  it('สายหลุดกลางคุย: มี handle → ต่อใหม่ · ไม่มี → onClosed', async () => {
    const a = await setup();
    await a.transport.connect(config, a.events);
    a.sockets[0]!.serverSays({ sessionResumptionUpdate: { resumable: true, newHandle: 'H' } });
    a.sockets[0]!.dropped();
    await flush();
    expect(a.sockets).toHaveLength(2);
    expect(a.log).not.toContain('closed');

    const b = await setup();
    await b.transport.connect(config, b.events);
    b.sockets[0]!.dropped();
    expect(b.log).toContain('closed');
  });

  it('close(): ปิด socket + หยุดเสียง · หลังนั้นสายหลุดไม่แจ้ง onClosed', async () => {
    const { transport, sockets, audio, log, events } = await setup();
    await transport.connect(config, events);
    const ws = sockets[0]!;
    transport.close();
    expect(ws.closed).toBe(true);
    expect(audio.stopped).toBe(1);
    ws.dropped(1000);
    expect(log).not.toContain('closed');
  });

  it('เปิดไมค์ไม่ได้ → ปิดสายแล้ว reject', async () => {
    const { transport, sockets, audio, events } = await setup();
    audio.startError = new ProviderError('realtime', 'server', 'mic busy');
    await expect(transport.connect(config, events)).rejects.toThrow('mic busy');
    expect(sockets[0]?.closed).toBe(true);
  });

  it('interrupt() ล้างคิวเสียงฝั่งเครื่อง', async () => {
    const { transport, audio, events } = await setup();
    await transport.connect(config, events);
    transport.interrupt();
    expect(audio.cleared).toBe(1);
  });
});

describe('registry', () => {
  const fake = (id: 'gemini' | 'openai', configured: boolean): RealtimeProvider => ({
    id,
    name: id,
    isConfigured: async () => configured,
    createTransport: () => ({ id }) as unknown as RealtimeTransport,
  });

  it('auto: เลือกเจ้าแรกที่พร้อม (Gemini ก่อน)', async () => {
    expect(
      (await pickRealtimeProvider('auto', [fake('gemini', true), fake('openai', true)]))?.id,
    ).toBe('gemini');
    expect(
      (await pickRealtimeProvider('auto', [fake('gemini', false), fake('openai', true)]))?.id,
    ).toBe('openai');
    expect(
      await pickRealtimeProvider('auto', [fake('gemini', false), fake('openai', false)]),
    ).toBeNull();
  });

  it('บังคับเจ้า → ได้เจ้านั้นแม้ยังไม่พร้อม (ให้ error บอกทางแก้)', async () => {
    expect(
      (await pickRealtimeProvider('openai', [fake('gemini', true), fake('openai', false)]))?.id,
    ).toBe('openai');
  });

  it('RoutedTransport: ไม่มีเจ้าพร้อม → missing_key · ส่งต่อคำสั่งให้ตัวที่เลือก', async () => {
    const empty = new RoutedTransport(async () => null);
    await expect(empty.connect(config, makeEvents().events)).rejects.toMatchObject({
      kind: 'missing_key',
    });

    const calls: string[] = [];
    const inner: RealtimeTransport = {
      connect: async () => void calls.push('connect'),
      sendToolResult: (id) => void calls.push(`result:${id}`),
      interrupt: () => void calls.push('interrupt'),
      close: () => void calls.push('close'),
    };
    const routed = new RoutedTransport(async () => ({
      ...fake('gemini', true),
      createTransport: () => inner,
    }));
    await routed.connect(config, makeEvents().events);
    routed.sendToolResult('c', 'x');
    routed.interrupt();
    routed.close();
    expect(calls).toEqual(['connect', 'result:c', 'interrupt', 'close']);
  });
});
