/**
 * @file Realtime Voice Session — คุยด้วยเสียงสดแบบ speech-to-speech (ไม่มีขั้น อัดไฟล์ → STT → LLM → TTS)
 *
 * โมเดลเสียงฟัง/ตอบเป็นสตรีมเดียว ตัดจบประโยค (VAD) และรับพูดแทรก (barge-in) ที่ฝั่งเซิร์ฟเวอร์ —
 * session นี้เป็น state machine ล้วน ๆ (DI ทั้งหมด เหมือน `LiveVoiceSession`) ตัวต่อเข้าแอปอยู่ที่
 * `features/jarvis/hooks/useRealtimeVoice.ts`
 *
 * **ทำไมคุยเร็วและประหยัด**
 * - เสียงเดินตรงมือถือ ↔ ผู้ให้บริการ (ไม่ผ่านเซิร์ฟเวอร์เรา ไม่อัปโหลดไฟล์ ไม่รอ STT/TTS ต่อคิว)
 * - โมเดลเสียงเป็นแค่ "ปากกับหู": คุยเล่น/ทักทายตอบเอง · งานที่ต้องใช้ memory, agent, เครื่องมือ, ข้อมูลจริง
 *   ส่งต่อ (delegate) ผ่าน tool `ask_atom` เข้า router เดิมของแอป แล้วอ่านผลที่ได้ → prompt ของโมเดลเสียงสั้น
 *   และไม่ต้องยัด memory/skills ทั้งหมดเข้า context ราคาแพงของโมเดลเสียง
 * - คำตอบสั้น (จำกัดที่ instructions + max output) · ไม่มีใครพูด `REALTIME_IDLE_TIMEOUT_MS` = ตัดสาย
 *   (เสียงที่สตรีมขึ้นไปถูกคิดเงินแม้เป็นความเงียบ)
 */

import { toProviderError, userAdvice } from '../../../core/http/errors';
import type { LiveVoiceState } from '../live/LiveVoiceSession';
import type { RealtimeConfig, RealtimeEvents, RealtimeToolCall, RealtimeTransport } from './types';

/** ชื่อ tool ที่โมเดลเสียงใช้ส่งงานเข้าสมองของแอป */
export const ASK_TOOL_NAME = 'ask_atom';
/** ไม่มีใครพูด/ไม่มีการตอบนานเท่านี้ = ตัดสายเอง (กันเปิดไมค์ค้าง + ค่าเสียงที่สตรีมเปล่า ๆ) */
export const REALTIME_IDLE_TIMEOUT_MS = 60_000;

export const REALTIME_IDLE_MESSAGE = `ปิดโหมดคุยด้วยเสียงแล้ว เพราะเงียบนาน ${REALTIME_IDLE_TIMEOUT_MS / 1000} วินาที — กดค้างที่ Orb หรือกดปุ่มไมค์เพื่อเริ่มใหม่`;
export const REALTIME_DROPPED_MESSAGE = '⚠️ การเชื่อมต่อเสียงสดหลุด — ลองเริ่มคุยใหม่อีกครั้ง';
export const REALTIME_KEY_MESSAGE =
  '⚠️ ยังไม่ได้ตั้งค่า API key สำหรับเสียงสด — ใส่ Gemini key ที่ ตั้งค่า › AI (หรือ OpenAI key ที่ ตั้งค่า › เสียง) แล้วลองใหม่';
const DELEGATE_FAILED = 'ขออภัย ทำรายการนี้ไม่สำเร็จ';

export interface RealtimeTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: RealtimeTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  // handle มาจาก setTimeout ด้านบนเสมอ — cast เพื่อไม่ผูก interface กับชนิด timer ของ Node/RN
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RealtimeVoiceDeps {
  transport: RealtimeTransport;
  /** ประกอบ config ตอนเริ่ม (persona ปัจจุบัน, tool) */
  buildConfig(): Promise<RealtimeConfig>;
  /** ขอสิทธิ์ไมค์ — reject ด้วย ProviderError `permission` */
  ensureMic(): Promise<void>;
  /**
   * ส่งงานเข้าสมองของแอป (router → handler) แล้วคืนคำตอบเป็นข้อความ — **ไม่พูด** (โมเดลเสียงเป็นคนอ่านเอง)
   * ข้อความผู้ใช้/คำตอบถูก push เข้าแชทโดยฝั่งนี้
   */
  ask(request: string): Promise<string>;
  /** เทิร์นที่โมเดลเสียงตอบเองทั้งหมด (ไม่ได้ delegate) — ใส่ลงแชทให้ประวัติครบ */
  onUserText(text: string): void;
  onAssistantText(text: string): void;
  onStateChange?(state: LiveVoiceState): void;
  /** ข้อความไทยที่ควรแสดงในแชท (error / เหตุผลที่ตัดสาย) */
  onMessage?(message: string): void;
  timers?: RealtimeTimers;
}

/** ข้อความไทยสำหรับ error ของเสียงสด */
export function describeRealtimeError(e: unknown): string {
  const err = toProviderError('realtime', e);
  if (err.kind === 'permission') return `⚠️ ${err.message.replace(/^\[[^\]]+\]\s*/, '')}`;
  if (err.kind === 'missing_key') return REALTIME_KEY_MESSAGE;
  return `⚠️ ${userAdvice(err.kind)}\n${err.message}`;
}

interface TurnBuffer {
  user: string | null;
  assistant: string | null;
  delegated: boolean;
}

const emptyTurn = (): TurnBuffer => ({ user: null, assistant: null, delegated: false });

/**
 * idle → starting → listening ⇄ speaking · listening/speaking → thinking (รอ tool) → speaking → listening
 * `stop()` ได้จากทุกสถานะ — งาน async ที่ค้างถูกทิ้งด้วย `runId`
 */
export class RealtimeVoiceSession {
  private state: LiveVoiceState = 'idle';
  private runId = 0;
  private turn: TurnBuffer = emptyTurn();
  /** โมเดลกำลังตอบอยู่ (ตั้งตอน response.created, ล้างตอน response.done) */
  private responding = false;
  private pendingTools = 0;
  private idleTimer: unknown = null;
  private readonly timers: RealtimeTimers;

  constructor(private readonly deps: RealtimeVoiceDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  getState(): LiveVoiceState {
    return this.state;
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  async start(): Promise<void> {
    if (this.active) return;
    const run = ++this.runId;
    this.turn = emptyTurn();
    this.responding = false;
    this.pendingTools = 0;
    this.setState('starting');
    try {
      await this.deps.ensureMic();
      if (!this.isCurrent(run)) return;
      const config = await this.deps.buildConfig();
      if (!this.isCurrent(run)) return;
      await this.deps.transport.connect(config, this.eventsFor(run));
    } catch (e) {
      if (this.isCurrent(run)) this.fail(describeRealtimeError(e));
      return;
    }
    if (!this.isCurrent(run)) {
      this.deps.transport.close(); // บอสกดหยุดระหว่างต่อสาย
      return;
    }
    this.setState('listening');
    this.armIdle(run);
  }

  stop(): void {
    if (!this.active) return;
    this.runId++;
    this.end();
  }

  private isCurrent(run: number): boolean {
    return run === this.runId && this.active;
  }

  private setState(state: LiveVoiceState) {
    if (this.state === state) return;
    this.state = state;
    this.deps.onStateChange?.(state);
  }

  /** event จาก transport — ทุกตัวเช็ก run ก่อน (event ของสายเก่าที่ตกค้างต้องไม่กระทบรอบใหม่) */
  private eventsFor(run: number): RealtimeEvents {
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (this.isCurrent(run)) fn(...args);
      };
    return {
      onSpeechStarted: guard(() => {
        // พูดแทรก: ตัดเสียงที่กำลังพูดทันที (เซิร์ฟเวอร์ตัดฝั่งตัวเองแล้ว เราตัดเสียงที่ค้างบัฟเฟอร์ฝั่งเครื่อง)
        if (this.state === 'speaking') this.deps.transport.interrupt();
        if (this.pendingTools === 0) this.setState('listening');
        this.armIdle(run);
      }),
      onUserTranscript: guard((text) => {
        const clean = text.trim();
        if (!clean) return;
        // ถอดเสียงมาช้ากว่าคำตอบ (เกิดได้) → ลงแชทเลย ไม่รอเทิร์นหน้า
        if (!this.responding && this.pendingTools === 0) this.deps.onUserText(clean);
        else this.turn.user = clean;
      }),
      onResponseStarted: guard(() => {
        this.responding = true;
        this.setState('speaking');
        this.armIdle(run);
      }),
      onAssistantTranscript: guard((text) => {
        const clean = text.trim();
        if (clean)
          this.turn.assistant = this.turn.assistant ? `${this.turn.assistant} ${clean}` : clean;
      }),
      onResponseDone: guard(({ hadToolCall }) => {
        this.responding = false;
        if (hadToolCall || this.pendingTools > 0) {
          if (this.pendingTools > 0) this.setState('thinking');
          return;
        }
        this.flushTurn();
        this.setState('listening');
        this.armIdle(run);
      }),
      onToolCall: guard((call) => this.handleToolCall(run, call)),
      onError: guard((error) => this.fail(describeRealtimeError(error))),
      onClosed: guard(() => this.fail(REALTIME_DROPPED_MESSAGE)),
    };
  }

  private handleToolCall(run: number, call: RealtimeToolCall) {
    if (call.name !== ASK_TOOL_NAME) {
      this.deps.transport.sendToolResult(call.callId, `ไม่รู้จักเครื่องมือ ${call.name}`);
      return;
    }
    const request = parseRequest(call.args);
    this.turn.delegated = true;
    this.pendingTools++;
    this.setState('thinking');
    this.clearIdle(); // กำลังทำงานให้ผู้ใช้ — ไม่นับเป็นเงียบ
    void this.deps
      .ask(request)
      .then((reply) => reply.trim() || DELEGATE_FAILED)
      .catch(() => DELEGATE_FAILED)
      .then((output) => {
        if (!this.isCurrent(run)) return; // บอสกดหยุดระหว่างรอ — ห้ามส่งผล/พูดย้อนหลัง
        this.pendingTools--;
        this.deps.transport.sendToolResult(call.callId, output);
        this.armIdle(run);
      });
  }

  /** เทิร์นที่โมเดลเสียงตอบเอง → ลงแชท · เทิร์นที่ delegate → router ลงแชทให้แล้ว ไม่ซ้ำ */
  private flushTurn() {
    const { user, assistant, delegated } = this.turn;
    this.turn = emptyTurn();
    if (delegated) return;
    if (user) this.deps.onUserText(user);
    if (assistant) this.deps.onAssistantText(assistant);
  }

  private armIdle(run: number) {
    this.clearIdle();
    this.idleTimer = this.timers.setTimeout(() => {
      if (this.isCurrent(run) && this.state === 'listening') this.fail(REALTIME_IDLE_MESSAGE);
      else if (this.isCurrent(run)) this.armIdle(run); // ยังตอบ/ทำงานอยู่ — นับใหม่
    }, REALTIME_IDLE_TIMEOUT_MS);
  }

  private clearIdle() {
    if (this.idleTimer === null) return;
    this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private fail(message: string) {
    this.runId++;
    this.end();
    this.deps.onMessage?.(message);
  }

  /** เก็บกวาดทุกอย่าง — ไม่ throw (เรียกจาก stop() แบบ sync ได้) */
  private end() {
    this.clearIdle();
    this.responding = false;
    this.pendingTools = 0;
    this.turn = emptyTurn();
    try {
      this.deps.transport.close();
    } catch (e) {
      console.error('[realtime] ปิดการเชื่อมต่อไม่สำเร็จ', e);
    }
    this.setState('idle');
  }
}

/** ดึงข้อความคำขอจาก argument ของ tool — ไม่ใช่ JSON / ไม่มี field ก็ใช้ข้อความดิบ */
export function parseRequest(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed && typeof parsed === 'object' && 'request' in parsed) {
      const value = (parsed as { request: unknown }).request;
      if (typeof value === 'string') return value.trim();
    }
  } catch {
    // ตกไปใช้ข้อความดิบ
  }
  return args.trim();
}
