/**
 * @file Live Voice Session — คุยด้วยเสียงแบบไลฟ์ (ฟัง → ถอดเสียง → คิด → พูด → ฟังใหม่ วนไปจนบอสสั่งหยุด)
 *
 * เป็น state machine ล้วน ๆ: ไม่ import native module — recorder / STT / ส่งข้อความ / นาฬิกา ส่งเข้ามาทาง
 * constructor (DI) เพื่อให้ test ได้ด้วย fake timers ทั้งหมด · ตัวต่อเข้าแอปจริงอยู่ที่
 * `features/jarvis/hooks/useLiveVoice.ts`
 *
 * ตรวจจับเสียงพูด (VAD) จากระดับเสียง metering (dBFS) ที่ poll ทุก `METER_INTERVAL_MS`:
 * - ดังกว่า `SPEECH_THRESHOLD_DB` = เริ่มพูด · เงียบต่อเนื่อง `SILENCE_END_MS` = จบประโยค
 * - เสียงสั้นกว่า `MIN_SPEECH_MS` = เสียงรบกวน (ไม่ส่งถอดเสียง ฟังต่อ)
 * - พูดยาวเกิน `MAX_UTTERANCE_MS` = ตัดส่งเลย · ไม่มีใครพูดเลย `IDLE_TIMEOUT_MS` = ออกจากโหมดไลฟ์เอง
 *
 * โหมดเฝ้า (อัลตรอน, ADR-015 ขั้น 4): `keepAlive()` = true → ไม่ออกเองเมื่อเงียบ · `requireWakeWord()` = true
 * (แอปอยู่เบื้องหลัง) → ตอบเฉพาะประโยคที่ขึ้นต้นด้วยชื่อ persona ({@link stripWakeWord}) ที่เหลือทิ้งเงียบ ๆ
 *
 * ระหว่างผู้ช่วยพูด **ไม่บันทึกเสียง** (กันไมค์ได้ยินเสียงตัวเองแล้ววนตอบตัวเอง) — ยังไม่รองรับพูดแทรก (barge-in)
 */

import { redactSecrets, toProviderError, userAdvice } from '../../../core/http/errors';
import { stripWakeWord } from './wakeWord';

/** ดังกว่านี้ (dBFS) = มีคนพูด — Android ได้ค่า peak (maxAmplitude), iOS ได้ค่าเฉลี่ย จึงเลือกค่ากลาง ๆ */
export const SPEECH_THRESHOLD_DB = -40;
/** เงียบต่อเนื่องนานเท่านี้หลังพูด = จบประโยค (สั้นลงจาก 1200 → ตอบไวขึ้น แต่ยังเผื่อการพักหายใจกลางประโยค · ปรับที่นี่ถ้าเครื่องตัดเร็ว/ช้าไป) */
export const SILENCE_END_MS = 900;
/** เสียงที่ดังสั้นกว่านี้ถือเป็นเสียงรบกวน (เคาะโต๊ะ, ไอ) */
export const MIN_SPEECH_MS = 400;
/** ตัดประโยคที่ยาวเกินนี้ส่งถอดเสียงเลย (ไฟล์ใหญ่ = อัปโหลดช้า + เสียเงิน STT) */
export const MAX_UTTERANCE_MS = 30_000;
/** ไม่มีใครพูดเลยนานเท่านี้ = ออกจากโหมดไลฟ์เอง (กันไมค์เปิดค้างทั้งวัน) */
export const IDLE_TIMEOUT_MS = 30_000;
/** ยังไม่เริ่มพูดนานเท่านี้ → ทิ้งไฟล์แล้วอัดใหม่ ไฟล์ที่ส่ง STT จะได้ไม่มีความเงียบยาว ๆ นำหน้า */
export const PRE_SPEECH_RESET_MS = 8_000;
/** ถี่แค่ไหนในการอ่านระดับเสียง */
export const METER_INTERVAL_MS = 100;

export type LiveVoiceState =
  'idle' | 'starting' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

/** ข้อความสถานะที่แสดงบนหน้าหลัก (idle = ไม่แสดง) */
export const LIVE_STATE_LABEL: Record<Exclude<LiveVoiceState, 'idle'>, string> = {
  starting: 'กำลังเปิดไมค์…',
  listening: 'กำลังฟัง…',
  transcribing: 'กำลังถอดเสียง…',
  thinking: 'กำลังคิด…',
  speaking: 'กำลังพูด…',
};

export const STT_NOT_CONFIGURED =
  'ยังไม่ได้ตั้งค่าบริการแปลงเสียงเป็นข้อความ (STT) — เลือกผู้ให้บริการและใส่ API key ได้ที่ ตั้งค่า › เสียง แล้วลองคุยด้วยเสียงใหม่อีกครั้ง';
export const STT_AUTH_FAILED =
  'API key ของบริการแปลงเสียงเป็นข้อความ (STT) ไม่ถูกต้องหรือหมดสิทธิ์ — ตรวจสอบได้ที่ ตั้งค่า › เสียง';
export const IDLE_TIMEOUT_MESSAGE = `ปิดโหมดคุยด้วยเสียงแล้ว เพราะไม่ได้ยินเสียงพูด ${IDLE_TIMEOUT_MS / 1000} วินาที — กดค้างที่ Orb หรือกดปุ่มไมค์เพื่อเริ่มใหม่`;
const RECORDER_FAILED = 'เปิดไมโครโฟนไม่สำเร็จ — ปิดแอปอื่นที่ใช้ไมค์อยู่แล้วลองใหม่';

/** สิ่งที่ session ต้องการจากเครื่องบันทึกเสียง (แอปจริงห่อ expo-audio AudioRecorder) */
export interface LiveRecorder {
  /** เตรียม + เริ่มบันทึกไฟล์ใหม่ */
  start(): Promise<void>;
  /** ระดับเสียงล่าสุด (dBFS, 0 = ดังสุด) · undefined = อ่านไม่ได้ */
  level(): number | undefined;
  /** หยุดบันทึก คืน uri ของไฟล์ (null = ไม่มีไฟล์) */
  stop(): Promise<string | null>;
  /** ออกจากโหมดไลฟ์: คืนโหมดเสียงของเครื่อง (ไม่บังคับ) */
  release?(): Promise<void>;
  /** ลบไฟล์ที่ไม่ใช้แล้ว (best-effort) */
  discard?(uri: string): void;
}

export interface LiveRespondHooks {
  /**
   * เรียกก่อนผู้ช่วยเริ่มพูด — คืน false = session ถูกหยุดแล้ว ห้ามพูด
   * (บอสกดหยุดระหว่างรอ AI ตอบ เสียงต้องไม่ดังขึ้นมาทีหลัง)
   */
  onSpeaking(): boolean;
}

export interface LiveTimers {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LiveVoiceDeps {
  recorder: LiveRecorder;
  /** ขอสิทธิ์ไมค์ — reject ด้วย ProviderError `permission` (ข้อความไทย) */
  ensureMic(): Promise<void>;
  /** ถอดเสียงจากไฟล์ (VoiceOrchestrator.listen) */
  transcribe(uri: string): Promise<string>;
  /** ส่งข้อความเข้าแชทแล้วรอจนพูดจบ (conversation.sendMessage) */
  respond(text: string, hooks: LiveRespondHooks): Promise<void>;
  /** หยุดเสียงที่พูดค้าง (VoiceOrchestrator.stop) */
  stopSpeech(): void;
  onStateChange?(state: LiveVoiceState): void;
  /** ข้อความไทยที่ควรแสดงในแชท (error / เหตุผลที่ออกจากโหมดไลฟ์) */
  onMessage?(message: string): void;
  /** true = ไม่ออกเองเมื่อเงียบ {@link IDLE_TIMEOUT_MS} (โหมดเฝ้า) — อ่านทุก tick จึงเปลี่ยนกลางทางได้ */
  keepAlive?(): boolean;
  /** true = ต้องขึ้นต้นด้วยชื่อ persona ถึงจะตอบ (โหมดเฝ้าตอนแอปอยู่เบื้องหลัง) — อ่านหลังถอดเสียงทุกประโยค */
  requireWakeWord?(): boolean;
  timers?: LiveTimers;
}

const REAL_TIMERS: LiveTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  // handle มาจาก setInterval ด้านบนเสมอ — cast เพื่อให้ interface ไม่ผูกกับชนิด timer ของ Node/RN
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** ข้อความไทยสำหรับ error ระหว่างโหมดไลฟ์ — ไม่มี STT / key ผิด → ชี้ไป ตั้งค่า › เสียง */
export function describeLiveError(e: unknown): string {
  const err = toProviderError('voice', e);
  // permission: ensureMicPermission เขียนข้อความไทยที่บอกทางแก้ไว้แล้ว
  if (err.kind === 'permission') return `⚠️ ${err.message.replace(/^\[[^\]]+\]\s*/, '')}`;
  if (err.kind === 'missing_key' || err.kind === 'unsupported') return `⚠️ ${STT_NOT_CONFIGURED}`;
  if (err.kind === 'auth') return `⚠️ ${STT_AUTH_FAILED}`;
  return `⚠️ ถอดเสียงไม่สำเร็จ — ${userAdvice(err.kind)}\n${redactSecrets(err.message)}`;
}

/**
 * วงจรคุยด้วยเสียง: idle → starting → listening → transcribing → thinking → speaking → listening …
 * `stop()` ได้จากทุกสถานะ — งาน async ที่ค้างอยู่ถูกทิ้งด้วย `runId` guard
 */
export class LiveVoiceSession {
  private state: LiveVoiceState = 'idle';
  /** เพิ่มทุกครั้งที่ start/stop — งาน async ของรอบเก่าเช็กแล้วเลิกเอง */
  private runId = 0;
  private meter: unknown = null;
  private recording = false;

  // VAD ของประโยคปัจจุบัน
  /** เริ่มฟังรอบนี้เมื่อไร — นับ idle ใหม่ทุกรอบ (ตอบเสร็จแล้วบอสเงียบ 30s ก็ออกเหมือนกัน) */
  private listenStartedAt = 0;
  private segmentStartedAt = 0;
  private speechStartedAt: number | null = null;
  private lastVoiceAt = 0;
  /** กำลัง stop/restart recorder อยู่ — tick ที่มาระหว่างนั้นไม่ทำอะไร */
  private busy = false;

  private readonly timers: LiveTimers;

  constructor(private readonly deps: LiveVoiceDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  getState(): LiveVoiceState {
    return this.state;
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** เข้าโหมดไลฟ์ (เรียกซ้ำตอนทำงานอยู่ = ไม่ทำอะไร) */
  async start(): Promise<void> {
    if (this.active) return;
    const run = ++this.runId;
    this.setState('starting');
    try {
      await this.deps.ensureMic();
    } catch (e) {
      if (this.isCurrent(run)) await this.fail(describeLiveError(e));
      return;
    }
    if (!this.isCurrent(run)) return;
    await this.listen(run);
  }

  /** ออกจากโหมดไลฟ์ทันที: หยุดอัด หยุดพูด งานที่ค้างถูกทิ้ง */
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

  private async listen(run: number): Promise<void> {
    try {
      await this.deps.recorder.start();
      this.recording = true;
    } catch (e) {
      console.error('[voice] เริ่มบันทึกเสียงไม่สำเร็จ', e);
      if (this.isCurrent(run)) await this.fail(`⚠️ ${RECORDER_FAILED}`);
      return;
    }
    if (!this.isCurrent(run)) return;
    const now = this.timers.now();
    this.listenStartedAt = now;
    this.segmentStartedAt = now;
    this.speechStartedAt = null;
    this.lastVoiceAt = now;
    this.busy = false;
    this.setState('listening');
    this.meter = this.timers.setInterval(() => this.tick(run), METER_INTERVAL_MS);
  }

  /** อ่านระดับเสียง 1 ครั้ง แล้วตัดสินว่าเริ่มพูด / จบประโยค / หมดเวลา */
  private tick(run: number) {
    if (!this.isCurrent(run) || this.state !== 'listening' || this.busy) return;
    const now = this.timers.now();
    const level = this.deps.recorder.level() ?? -160;

    if (level >= SPEECH_THRESHOLD_DB) {
      this.speechStartedAt ??= now;
      this.lastVoiceAt = now;
    }

    if (this.speechStartedAt !== null) {
      if (now - this.speechStartedAt >= MAX_UTTERANCE_MS) {
        void this.finishUtterance(run);
        return;
      }
      if (now - this.lastVoiceAt >= SILENCE_END_MS) {
        if (this.lastVoiceAt - this.speechStartedAt < MIN_SPEECH_MS) {
          // เสียงสั้น ๆ = รบกวน: ฟังต่อในไฟล์เดิม (เสียงเคาะเล็ก ๆ ไม่ทำให้ STT เพี้ยน)
          this.speechStartedAt = null;
        } else {
          void this.finishUtterance(run);
        }
      }
      return;
    }

    if (!this.deps.keepAlive?.() && now - this.listenStartedAt >= IDLE_TIMEOUT_MS) {
      void this.fail(IDLE_TIMEOUT_MESSAGE);
      return;
    }
    if (now - this.segmentStartedAt >= PRE_SPEECH_RESET_MS) void this.restartSegment(run);
  }

  /** ทิ้งไฟล์ที่มีแต่ความเงียบแล้วเริ่มอัดใหม่ (เวลา idle นับต่อจากเดิม) */
  private async restartSegment(run: number) {
    this.busy = true;
    try {
      const uri = await this.stopRecorder();
      if (uri) this.deps.recorder.discard?.(uri);
      if (!this.isCurrent(run)) return;
      await this.deps.recorder.start();
      this.recording = true;
    } catch (e) {
      console.error('[voice] เริ่มบันทึกเสียงใหม่ไม่สำเร็จ', e);
      if (this.isCurrent(run)) await this.fail(`⚠️ ${RECORDER_FAILED}`);
      return;
    }
    if (!this.isCurrent(run)) return;
    this.segmentStartedAt = this.timers.now();
    this.busy = false;
  }

  private async finishUtterance(run: number) {
    this.clearMeter();
    this.setState('transcribing');
    let uri: string | null;
    try {
      uri = await this.stopRecorder();
    } catch (e) {
      console.error('[voice] หยุดบันทึกเสียงไม่สำเร็จ', e);
      if (this.isCurrent(run)) await this.fail(`⚠️ ${RECORDER_FAILED}`);
      return;
    }
    if (!this.isCurrent(run)) {
      if (uri) this.deps.recorder.discard?.(uri);
      return;
    }
    if (!uri) {
      await this.listen(run);
      return;
    }

    let text: string;
    try {
      text = (await this.deps.transcribe(uri)).trim();
    } catch (e) {
      if (this.isCurrent(run)) await this.fail(describeLiveError(e));
      return;
    } finally {
      this.deps.recorder.discard?.(uri);
    }
    if (!this.isCurrent(run)) return;
    // ไม่ได้เรียกชื่อ (เสียงทีวี/คนคุยกัน) หรือเรียกชื่อเฉย ๆ → ฟังต่อเงียบ ๆ
    if (text && this.deps.requireWakeWord?.()) text = stripWakeWord(text) ?? '';
    // ถอดเสียงแล้วว่าง (พูดไม่ชัด / เสียงลม) → ฟังใหม่เงียบ ๆ ไม่ต้องรบกวนบอส
    if (!text) {
      await this.listen(run);
      return;
    }

    this.setState('thinking');
    try {
      await this.deps.respond(text, {
        onSpeaking: () => {
          if (!this.isCurrent(run)) return false;
          this.setState('speaking');
          return true;
        },
      });
    } catch (e) {
      // sendMessage จับ error เองอยู่แล้ว — มาถึงนี่ = bug ฝั่งเรียก; log แล้วออกจากโหมดไลฟ์
      console.error('[voice] ส่งข้อความจากเสียงไม่สำเร็จ', e);
      if (this.isCurrent(run))
        await this.fail(`⚠️ ${userAdvice(toProviderError('voice', e).kind)}`);
      return;
    }
    if (this.isCurrent(run)) await this.listen(run);
  }

  private async stopRecorder(): Promise<string | null> {
    if (!this.recording) return null;
    this.recording = false;
    return this.deps.recorder.stop();
  }

  private async fail(message: string) {
    this.runId++;
    this.end();
    this.deps.onMessage?.(message);
  }

  /** เก็บกวาดทุกอย่าง — ไม่ throw (เรียกจาก stop() แบบ sync ได้) */
  private end() {
    this.clearMeter();
    this.busy = false;
    this.speechStartedAt = null;
    this.deps.stopSpeech();
    const { recorder } = this.deps;
    void this.stopRecorder()
      .then((uri) => {
        if (uri) recorder.discard?.(uri);
      })
      .catch((e: unknown) => console.error('[voice] หยุดบันทึกเสียงไม่สำเร็จ', e))
      .then(() => recorder.release?.())
      .catch((e: unknown) => console.error('[voice] คืนโหมดเสียงไม่สำเร็จ', e));
    this.setState('idle');
  }

  private clearMeter() {
    if (this.meter === null) return;
    this.timers.clearInterval(this.meter);
    this.meter = null;
  }
}
