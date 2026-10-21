/**
 * @file System Speech Session — คุยด้วยเสียงโดยใช้ตัวรู้จำเสียงของระบบ (Google บน Android / Apple บน iOS)
 *
 * ฟังจากไมค์ตรง ๆ แล้วได้ข้อความกลับพร้อมตัดจบประโยคให้ในตัว → ไม่ต้องอัดไฟล์, ไม่ต้องมี API key STT, ฟรี
 * วงจร: ฟัง → คิด (router เดิม) → พูด (TTS เดิม) → ฟังใหม่ · เป็น fallback ของเสียงสด (Gemini/OpenAI)
 * และดีกว่าโหมดอัดไฟล์ + STT คลาวด์เดิม
 *
 * state machine ล้วน (DI) เหมือน `LiveVoiceSession` — ตัวต่อ native อยู่ที่ `SystemRecognizer.ts`
 */

import { toProviderError, userAdvice } from '../../../core/http/errors';
import type { LiveRespondHooks, LiveVoiceState } from './LiveVoiceSession';

/** ฟังเงียบติดกันกี่รอบ (รอบละ ~5–8 วินาทีตามระบบ) ถึงออกจากโหมด */
export const MAX_EMPTY_ROUNDS = 4;
export const SYSTEM_IDLE_MESSAGE =
  'ปิดโหมดคุยด้วยเสียงแล้ว เพราะไม่ได้ยินเสียงพูดนาน — กดค้างที่ Orb หรือกดปุ่มไมค์เพื่อเริ่มใหม่';
export const SYSTEM_UNAVAILABLE_MESSAGE =
  '⚠️ เครื่องนี้ไม่มีบริการรู้จำเสียงพูดของระบบ — ติดตั้ง/เปิดใช้ Google (Speech Services) หรือใส่ API key STT ที่ ตั้งค่า › เสียง';

export interface SystemRecognizer {
  /** ระบบนี้มีตัวรู้จำเสียงพร้อมใช้ไหม */
  isAvailable(): boolean;
  /** ฟังหนึ่งประโยค: คืนข้อความสุดท้าย ('' = ไม่มีเสียงพูด) · reject = error (ProviderError) */
  listenOnce(): Promise<string>;
  /** ยกเลิกการฟังที่ค้างอยู่ทันที (ไม่ throw) */
  abort(): void;
}

export interface SystemSpeechDeps {
  recognizer: SystemRecognizer;
  ensureMic(): Promise<void>;
  respond(text: string, hooks: LiveRespondHooks): Promise<void>;
  stopSpeech(): void;
  onStateChange?(state: LiveVoiceState): void;
  onMessage?(message: string): void;
}

/** ข้อความไทยสำหรับ error ของตัวรู้จำเสียงระบบ */
export function describeSystemError(e: unknown): string {
  const err = toProviderError('system-stt', e);
  if (err.kind === 'permission') return `⚠️ ${err.message.replace(/^\[[^\]]+\]\s*/, '')}`;
  if (err.kind === 'unsupported') return SYSTEM_UNAVAILABLE_MESSAGE;
  return `⚠️ ถอดเสียงไม่สำเร็จ — ${userAdvice(err.kind)}\n${err.message}`;
}

export class SystemSpeechSession {
  private state: LiveVoiceState = 'idle';
  private runId = 0;

  constructor(private readonly deps: SystemSpeechDeps) {}

  getState(): LiveVoiceState {
    return this.state;
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (!this.deps.recognizer.isAvailable()) {
      this.deps.onMessage?.(SYSTEM_UNAVAILABLE_MESSAGE);
      return;
    }
    const run = ++this.runId;
    this.setState('starting');
    try {
      await this.deps.ensureMic();
    } catch (e) {
      if (this.isCurrent(run)) this.fail(describeSystemError(e));
      return;
    }
    await this.loop(run);
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

  private async loop(run: number): Promise<void> {
    let emptyRounds = 0;
    while (this.isCurrent(run)) {
      this.setState('listening');
      let text: string;
      try {
        text = (await this.deps.recognizer.listenOnce()).trim();
      } catch (e) {
        if (this.isCurrent(run)) this.fail(describeSystemError(e));
        return;
      }
      if (!this.isCurrent(run)) return;
      if (!text) {
        if (++emptyRounds >= MAX_EMPTY_ROUNDS) {
          this.fail(SYSTEM_IDLE_MESSAGE);
          return;
        }
        continue;
      }
      emptyRounds = 0;

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
        // sendMessage จับ error เองอยู่แล้ว — มาถึงนี่ = bug ฝั่งเรียก; log แล้วออกจากโหมด
        console.error('[voice] ส่งข้อความจากเสียงไม่สำเร็จ', e);
        if (this.isCurrent(run)) this.fail(`⚠️ ${userAdvice(toProviderError('voice', e).kind)}`);
        return;
      }
    }
  }

  private fail(message: string) {
    this.runId++;
    this.end();
    this.deps.onMessage?.(message);
  }

  /** เก็บกวาดทุกอย่าง — ไม่ throw (เรียกจาก stop() แบบ sync ได้) */
  private end() {
    this.deps.recognizer.abort();
    this.deps.stopSpeech();
    this.setState('idle');
  }
}
