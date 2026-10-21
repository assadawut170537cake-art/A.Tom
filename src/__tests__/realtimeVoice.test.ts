import { ProviderError } from '../core/http/errors';
import type { LiveVoiceState } from '../features/voice/live/LiveVoiceSession';
import { buildSessionBody } from '../features/voice/realtime/OpenAIRealtimeTransport';
import {
  ASK_TOOL_NAME,
  REALTIME_DROPPED_MESSAGE,
  REALTIME_IDLE_MESSAGE,
  REALTIME_IDLE_TIMEOUT_MS,
  REALTIME_KEY_MESSAGE,
  RealtimeVoiceSession,
  parseRequest,
} from '../features/voice/realtime/RealtimeVoiceSession';
import { buildInstructions, buildRealtimeConfig } from '../features/voice/realtime/config';
import type {
  RealtimeConfig,
  RealtimeEvents,
  RealtimeTransport,
} from '../features/voice/realtime/types';

class FakeTransport implements RealtimeTransport {
  events!: RealtimeEvents;
  connectError: Error | null = null;
  results: { callId: string; output: string }[] = [];
  interrupts = 0;
  closes = 0;

  async connect(_config: RealtimeConfig, events: RealtimeEvents) {
    if (this.connectError) throw this.connectError;
    this.events = events;
  }
  sendToolResult(callId: string, output: string) {
    this.results.push({ callId, output });
  }
  interrupt() {
    this.interrupts++;
  }
  close() {
    this.closes++;
  }
}

const openSessions: RealtimeVoiceSession[] = [];

function setup(
  overrides: { ask?: (r: string) => Promise<string>; ensureMic?: () => Promise<void> } = {},
) {
  const transport = new FakeTransport();
  const states: LiveVoiceState[] = [];
  const messages: string[] = [];
  const users: string[] = [];
  const assistants: string[] = [];
  const asked: string[] = [];
  const session = new RealtimeVoiceSession({
    transport,
    buildConfig: async () => buildRealtimeConfig(1),
    ensureMic: overrides.ensureMic ?? (async () => {}),
    ask:
      overrides.ask ??
      (async (r) => {
        asked.push(r);
        return 'ผลลัพธ์';
      }),
    onUserText: (t) => users.push(t),
    onAssistantText: (t) => assistants.push(t),
    onStateChange: (s) => states.push(s),
    onMessage: (m) => messages.push(m),
  });
  openSessions.push(session);
  return { session, transport, states, messages, users, assistants, asked };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('RealtimeVoiceSession', () => {
  afterEach(() => {
    // วางสายทุกเทสต์ — ไม่งั้นตัวจับเวลาเงียบ 60s ค้างทำให้ jest ไม่จบ
    for (const s of openSessions.splice(0)) s.stop();
    jest.useRealTimers();
  });

  it('start → listening และ stop → idle พร้อมปิดสาย', async () => {
    const { session, transport, states } = setup();
    await session.start();
    expect(session.getState()).toBe('listening');
    expect(states).toEqual(['starting', 'listening']);
    session.stop();
    expect(session.getState()).toBe('idle');
    expect(transport.closes).toBe(1);
  });

  it('เทิร์นที่โมเดลตอบเอง → ลงแชททั้งฝั่งผู้ใช้และผู้ช่วย หลัง response.done', async () => {
    const { session, transport, users, assistants } = setup();
    await session.start();
    const e = transport.events;
    e.onSpeechStarted();
    e.onResponseStarted();
    expect(session.getState()).toBe('speaking');
    e.onUserTranscript('สวัสดี');
    e.onAssistantTranscript('สวัสดีครับบอส');
    expect(users).toEqual([]); // ยังไม่ลงแชทจนกว่าเทิร์นจบ
    e.onResponseDone({ hadToolCall: false });
    expect(users).toEqual(['สวัสดี']);
    expect(assistants).toEqual(['สวัสดีครับบอส']);
    expect(session.getState()).toBe('listening');
  });

  it('พูดแทรกขณะผู้ช่วยพูด → interrupt แล้วกลับไปฟัง', async () => {
    const { session, transport } = setup();
    await session.start();
    transport.events.onResponseStarted();
    expect(session.getState()).toBe('speaking');
    transport.events.onSpeechStarted();
    expect(transport.interrupts).toBe(1);
    expect(session.getState()).toBe('listening');
  });

  it('พูดตอน listening ปกติ → ไม่ interrupt', async () => {
    const { session, transport } = setup();
    await session.start();
    transport.events.onSpeechStarted();
    expect(transport.interrupts).toBe(0);
  });

  it('ask_atom → thinking → ส่งผลกลับ → ไม่ลงแชทซ้ำ (router ลงให้แล้ว)', async () => {
    const { session, transport, users, assistants, asked } = setup();
    await session.start();
    const e = transport.events;
    e.onResponseStarted();
    e.onUserTranscript('จดโน้ตว่านัดหมอ');
    e.onToolCall({
      callId: 'c1',
      name: ASK_TOOL_NAME,
      args: JSON.stringify({ request: 'จดโน้ตว่านัดหมอ' }),
    });
    e.onResponseDone({ hadToolCall: true });
    expect(session.getState()).toBe('thinking');
    await flush();
    expect(asked).toEqual(['จดโน้ตว่านัดหมอ']);
    expect(transport.results).toEqual([{ callId: 'c1', output: 'ผลลัพธ์' }]);

    // คำตอบรอบสอง (อ่านผล)
    e.onResponseStarted();
    e.onAssistantTranscript('จดให้แล้วครับ');
    e.onResponseDone({ hadToolCall: false });
    expect(users).toEqual([]);
    expect(assistants).toEqual([]);
    expect(session.getState()).toBe('listening');
  });

  it('ask ล้ม → ส่งข้อความขออภัยกลับให้โมเดล ไม่ค้าง', async () => {
    const { session, transport } = setup({ ask: async () => Promise.reject(new Error('boom')) });
    await session.start();
    transport.events.onToolCall({ callId: 'c2', name: ASK_TOOL_NAME, args: '{"request":"x"}' });
    await flush();
    expect(transport.results[0]?.output).toContain('ไม่สำเร็จ');
  });

  it('ask ตอบว่าง → ส่งข้อความขออภัยแทน', async () => {
    const { session, transport } = setup({ ask: async () => '  ' });
    await session.start();
    transport.events.onToolCall({ callId: 'c3', name: ASK_TOOL_NAME, args: '{"request":"x"}' });
    await flush();
    expect(transport.results[0]?.output).toContain('ไม่สำเร็จ');
  });

  it('tool ที่ไม่รู้จัก → ตอบกลับทันที ไม่เรียก ask', async () => {
    const { session, transport, asked } = setup();
    await session.start();
    transport.events.onToolCall({ callId: 'c4', name: 'other', args: '{}' });
    expect(asked).toEqual([]);
    expect(transport.results[0]?.callId).toBe('c4');
  });

  it('กดหยุดระหว่างรอ ask → ไม่ส่งผลกลับย้อนหลัง', async () => {
    let release: (v: string) => void = () => {};
    const { session, transport } = setup({ ask: () => new Promise((r) => (release = r)) });
    await session.start();
    transport.events.onToolCall({ callId: 'c5', name: ASK_TOOL_NAME, args: '{"request":"x"}' });
    session.stop();
    release('ช้าไปแล้ว');
    await flush();
    expect(transport.results).toEqual([]);
  });

  it('ถอดเสียงมาช้ากว่าคำตอบ → ลงแชทเลยไม่รอเทิร์นหน้า', async () => {
    const { session, transport, users } = setup();
    await session.start();
    transport.events.onResponseStarted();
    transport.events.onResponseDone({ hadToolCall: false });
    transport.events.onUserTranscript('มาช้า');
    expect(users).toEqual(['มาช้า']);
  });

  it('event ของสายเก่าหลัง stop ไม่มีผล', async () => {
    const { session, transport, states } = setup();
    await session.start();
    const old = transport.events;
    session.stop();
    const before = states.length;
    old.onResponseStarted();
    old.onError(new Error('late'));
    expect(states.length).toBe(before);
  });

  it('ต่อสายไม่ได้ (ไม่มี key) → idle + ข้อความบอกให้ตั้งค่า', async () => {
    const { session, transport, messages } = setup();
    transport.connectError = new ProviderError('realtime', 'missing_key', 'no key');
    await session.start();
    expect(session.getState()).toBe('idle');
    expect(messages).toEqual([REALTIME_KEY_MESSAGE]);
  });

  it('ไม่ได้สิทธิ์ไมค์ → ไม่ต่อสาย', async () => {
    const { session, transport, messages } = setup({
      ensureMic: async () =>
        Promise.reject(new ProviderError('mic', 'permission', '[mic] ไม่ได้รับสิทธิ์ไมค์')),
    });
    await session.start();
    expect(session.getState()).toBe('idle');
    expect(transport.events).toBeUndefined();
    expect(messages[0]).toContain('ไม่ได้รับสิทธิ์ไมค์');
  });

  it('กดหยุดระหว่างต่อสาย → ปิดสายที่เพิ่งต่อ', async () => {
    const { session, transport } = setup();
    const starting = session.start();
    session.stop();
    await starting;
    expect(session.getState()).toBe('idle');
    expect(transport.closes).toBeGreaterThanOrEqual(1);
  });

  it('error / สายหลุดระหว่างคุย → ออกพร้อมข้อความ', async () => {
    const a = setup();
    await a.session.start();
    a.transport.events.onClosed();
    expect(a.session.getState()).toBe('idle');
    expect(a.messages).toEqual([REALTIME_DROPPED_MESSAGE]);

    const b = setup();
    await b.session.start();
    b.transport.events.onError(new ProviderError('realtime', 'auth', 'bad key'));
    expect(b.session.getState()).toBe('idle');
    expect(b.messages).toHaveLength(1);
  });

  it('เงียบเกินกำหนด → ตัดสายเอง', async () => {
    jest.useFakeTimers();
    const { session, messages } = setup();
    await session.start();
    jest.advanceTimersByTime(REALTIME_IDLE_TIMEOUT_MS + 1);
    expect(session.getState()).toBe('idle');
    expect(messages).toEqual([REALTIME_IDLE_MESSAGE]);
  });

  it('มีการพูด → นับเงียบใหม่ ไม่ตัดสายกลางบทสนทนา', async () => {
    jest.useFakeTimers();
    const { session, transport } = setup();
    await session.start();
    jest.advanceTimersByTime(REALTIME_IDLE_TIMEOUT_MS - 1000);
    transport.events.onSpeechStarted();
    jest.advanceTimersByTime(REALTIME_IDLE_TIMEOUT_MS - 1000);
    expect(session.getState()).toBe('listening');
  });

  it('start ซ้ำตอนทำงานอยู่ → ไม่ต่อสายซ้อน', async () => {
    const { session, states } = setup();
    await session.start();
    await session.start();
    expect(states).toEqual(['starting', 'listening']);
  });
});

describe('parseRequest', () => {
  it('ดึง request จาก JSON', () => expect(parseRequest('{"request":" สวัสดี "}')).toBe('สวัสดี'));
  it('ไม่ใช่ JSON → ใช้ข้อความดิบ', () => expect(parseRequest(' ขอดูโน้ต ')).toBe('ขอดูโน้ต'));
  it('JSON ไม่มี request → ใช้ข้อความดิบ', () => expect(parseRequest('{"a":1}')).toBe('{"a":1}'));
});

describe('config', () => {
  it('prompt สั้นและบอกให้ delegate ผ่าน ask_atom', () => {
    const text = buildInstructions(1);
    expect(text).toContain(ASK_TOOL_NAME);
    expect(text.length).toBeLessThan(700);
  });

  it('session body: เสียง + tool + ตัวคุมต้นทุน · ตัด extras ได้', () => {
    const config = buildRealtimeConfig(2);
    const full = buildSessionBody(config, 'm', true) as Record<string, any>;
    expect(full.model).toBe('m');
    expect(full.max_output_tokens).toBeGreaterThan(0);
    expect(full.truncation.type).toBe('retention_ratio');
    expect(full.audio.output.voice).toBe(config.voice);
    expect(full.audio.input.turn_detection.interrupt_response).toBe(true);
    expect(full.tools[0].name).toBe(ASK_TOOL_NAME);
    const lean = buildSessionBody(config, 'm', false) as Record<string, any>;
    expect(lean.max_output_tokens).toBeUndefined();
    expect(lean.truncation).toBeUndefined();
  });
});
