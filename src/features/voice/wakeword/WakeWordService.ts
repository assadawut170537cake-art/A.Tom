/**
 * @file ฟังคำปลุกจากไมค์ตลอดเวลาที่แอปเปิดอยู่และไม่ได้คุย — เจอแล้วเรียก `onWake` (เปิดโหมดคุยด้วยเสียง)
 *
 * ใช้ไมค์ผ่าน NativePcmAudio (16 kHz) คนละอินสแตนซ์กับเสียงสด: ต้อง `stop()` ให้เสร็จก่อนเริ่มคุย (ไมค์ใช้พร้อมกันไม่ได้)
 * ประมวลผลทีละก้อนตามลำดับ · ถ้าเครื่องช้าจนคิวค้างเกิน MAX_BACKLOG ก้อนจะทิ้งก้อนใหม่ (ดีกว่าหน่วงสะสม)
 * Android ไม่อนุญาตให้ใช้ไมค์ตอนแอปอยู่เบื้องหลังเงียบ ๆ → ฟังเฉพาะตอนแอปเปิดอยู่ (ผู้เรียกคุมด้วย AppState)
 */

import { NativePcmAudio, type PcmAudio } from '../realtime/NativePcmAudio';
import { base64ToBytes, pcm16BytesToFloat } from '../realtime/pcm';
import { OnnxWakeModels } from './OnnxWakeModels';
import {
  ChunkAssembler,
  WakeWordDetector,
  type WakeModels,
  type WakeOptions,
} from './WakeWordDetector';

export const MAX_BACKLOG = 6;
export interface WakeWordServiceDeps {
  audio?: () => PcmAudio;
  models?: WakeModels & { warmUp?(): Promise<void> };
  options?: Partial<WakeOptions>;
  onError?: (error: unknown) => void;
  /** ทุกก้อน (80 ms) — ใช้โหมดทดสอบสดแสดงคะแนนจริง */
  onScore?: (score: number, triggered: boolean) => void;
}

export class WakeWordService {
  private audio: PcmAudio | null = null;
  private running = false;
  private queue: Promise<void> = Promise.resolve();
  private backlog = 0;

  constructor(private readonly deps: WakeWordServiceDeps = {}) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** เริ่มฟัง · เรียกซ้ำตอนทำงานอยู่ = ไม่ทำอะไร */
  async start(onWake: () => void): Promise<void> {
    if (this.running) return;
    this.running = true;
    const models = this.deps.models ?? new OnnxWakeModels();
    const detector = new WakeWordDetector(models, this.deps.options);
    const assembler = new ChunkAssembler();
    this.backlog = 0;
    try {
      await models.warmUp?.(); // โหลดโมเดลก่อนเปิดไมค์ — ไม่ให้ก้อนแรกค้าง
      if (!this.running) return;
      const audio = (this.deps.audio ?? (() => new NativePcmAudio()))();
      this.audio = audio;
      await audio.start((b64) => {
        // ค่าระดับ int16 (ไม่ normalize) ตามที่โมเดล mel ต้องการ
        const samples = pcm16BytesToFloat(base64ToBytes(b64)).map((x) => x * 32768);
        for (const chunk of assembler.push(samples)) {
          if (this.backlog >= MAX_BACKLOG) continue;
          this.backlog++;
          this.queue = this.queue.then(async () => {
            try {
              if (!this.running) return;
              const { score, triggered } = await detector.pushChunk(chunk);
              this.deps.onScore?.(score, triggered);
              if (triggered) onWake();
            } catch (e) {
              this.deps.onError?.(e);
            } finally {
              this.backlog--;
            }
          });
        }
      });
    } catch (e) {
      this.running = false;
      this.audio = null;
      throw e;
    }
  }

  /** หยุดฟังและปล่อยไมค์ (รอให้ปล่อยจริงก่อนคืนค่า) */
  async stop(): Promise<void> {
    if (!this.running && !this.audio) return;
    this.running = false;
    const audio = this.audio;
    this.audio = null;
    await audio?.stop();
    await this.queue.catch(() => undefined);
  }
}
