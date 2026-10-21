import { ProviderError } from '../core/http/errors';
import type { LiveVoiceState } from '../features/voice/live/LiveVoiceSession';
import {
  MAX_EMPTY_ROUNDS,
  SYSTEM_IDLE_MESSAGE,
  SYSTEM_UNAVAILABLE_MESSAGE,
  SystemSpeechSession,
  type SystemRecognizer,
} from '../features/voice/live/SystemSpeechSession';

class FakeRecognizer implements SystemRecognizer {
  available = true;
  aborts = 0;
  calls = 0;
  /** คิวผลลัพธ์ของแต่ละรอบ: string = ข้อความ · Error = reject · Promise = รอจนกว่าจะ resolve เอง */
  script: (string | Error | Promise<string>)[] = [];
  isAvailable() {
    return this.available;
  }
  async listenOnce(): Promise<string> {
    this.calls++;
    const next = this.script.shift();
    if (next === undefined) return new Promise<string>(() => {}); // ค้างฟังต่อไปเรื่อย ๆ
    if (next instanceof Error) throw next;
    return next;
  }
  abort() {
    this.aborts++;
  }
}

function setup(respond?: (t: string) => Promise<void>) {
  const recognizer = new FakeRecognizer();
  const states: LiveVoiceState[] = [];
  const messages: string[] = [];
  const heard: string[] = [];
  let spoke = false;
  const session = new SystemSpeechSession({
    recognizer,
    ensureMic: async () => {},
    respond: async (text, hooks) => {
      heard.push(text);
      if (respond) await respond(text);
      spoke = hooks.onSpeaking();
    },
    stopSpeech: () => {},
    onStateChange: (s) => states.push(s),
    onMessage: (m) => messages.push(m),
  });
  return { session, recognizer, states, messages, heard, spoke: () => spoke };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('SystemSpeechSession', () => {
  it('ฟัง → คิด → พูด → ฟังใหม่ วนไป', async () => {
    const t = setup();
    t.recognizer.script = ['สวัสดี'];
    void t.session.start();
    await tick();
    await tick();
    expect(t.heard).toEqual(['สวัสดี']);
    expect(t.spoke()).toBe(true);
    expect(t.states).toEqual(['starting', 'listening', 'thinking', 'speaking', 'listening']);
    expect(t.recognizer.calls).toBe(2); // รอบสองกำลังฟังอยู่
    t.session.stop();
    expect(t.session.getState()).toBe('idle');
    expect(t.recognizer.aborts).toBe(1);
  });

  it('เงียบติดกัน MAX_EMPTY_ROUNDS รอบ → ออกพร้อมข้อความ', async () => {
    const t = setup();
    t.recognizer.script = Array<string>(MAX_EMPTY_ROUNDS).fill('');
    await t.session.start();
    expect(t.session.getState()).toBe('idle');
    expect(t.messages).toEqual([SYSTEM_IDLE_MESSAGE]);
    expect(t.recognizer.calls).toBe(MAX_EMPTY_ROUNDS);
  });

  it('พูดแล้วนับรอบเงียบใหม่', async () => {
    const t = setup();
    t.recognizer.script = ['', '', '', 'ขอดูโน้ต', '', '', ''];
    void t.session.start();
    await tick();
    await tick();
    expect(t.heard).toEqual(['ขอดูโน้ต']);
    expect(t.session.getState()).toBe('listening'); // ยังไม่ครบ 4 รอบเงียบหลังพูด → กำลังฟังต่อ
    t.session.stop();
  });

  it('ไม่มีตัวรู้จำเสียงในเครื่อง → ไม่เริ่ม + บอกวิธีแก้', async () => {
    const t = setup();
    t.recognizer.available = false;
    await t.session.start();
    expect(t.session.getState()).toBe('idle');
    expect(t.messages).toEqual([SYSTEM_UNAVAILABLE_MESSAGE]);
  });

  it('error ระหว่างฟัง → ออก + ข้อความไทย', async () => {
    const t = setup();
    t.recognizer.script = [new ProviderError('system-stt', 'unsupported', 'x')];
    await t.session.start();
    expect(t.session.getState()).toBe('idle');
    expect(t.messages[0]).toContain('บริการรู้จำเสียง');
  });

  it('ไม่ได้สิทธิ์ไมค์ → ไม่ฟัง', async () => {
    const recognizer = new FakeRecognizer();
    const messages: string[] = [];
    const session = new SystemSpeechSession({
      recognizer,
      ensureMic: async () =>
        Promise.reject(new ProviderError('mic', 'permission', '[mic] ไม่ได้รับสิทธิ์ไมค์')),
      respond: async () => {},
      stopSpeech: () => {},
      onMessage: (m) => messages.push(m),
    });
    await session.start();
    expect(recognizer.calls).toBe(0);
    expect(messages[0]).toContain('ไม่ได้รับสิทธิ์ไมค์');
  });

  it('กดหยุดระหว่างรอ AI ตอบ → ไม่พูดย้อนหลัง', async () => {
    let release: () => void = () => {};
    const t = setup(() => new Promise<void>((r) => (release = r)));
    t.recognizer.script = ['ถามหน่อย'];
    void t.session.start();
    await tick();
    expect(t.session.getState()).toBe('thinking');
    t.session.stop();
    release();
    await tick();
    expect(t.spoke()).toBe(false); // onSpeaking คืน false เพราะ session ถูกหยุดแล้ว
    expect(t.session.getState()).toBe('idle');
  });

  it('start ซ้ำตอนทำงานอยู่ → ไม่ฟังซ้อน', async () => {
    const t = setup();
    void t.session.start();
    await tick();
    await t.session.start();
    expect(t.recognizer.calls).toBe(1);
    t.session.stop();
  });
});
