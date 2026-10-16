/**
 * @file คิว sync แบบ offline-first ระหว่าง local กับ remote memory — **SKELETON**
 *
 * แนวคิด (ยังไม่ implement ส่วน flush):
 *
 * ```
 * save/remove/clear ──▶ LocalMemoryAdapter (เขียนทันที, ใช้ได้แม้ออฟไลน์)
 *                   └─▶ SyncQueue.enqueue(op)          (จดว่ายังไม่ได้ส่งขึ้น remote)
 *
 * ออนไลน์ / เปิดแอป ──▶ SyncQueue.flush(remote)
 *                        ├─ ส่งทีละ op ตามลำดับ (FIFO)
 *                        ├─ สำเร็จ → เอาออกจากคิว
 *                        └─ ล้ม → attempts++ แล้วรอรอบถัดไป (backoff)
 * ```
 *
 * TODO(phase-4.5):
 *   - เก็บคิวลง AsyncStorage (ตอนนี้อยู่ในหน่วยความจำ — ปิดแอปแล้วหาย)
 *   - implement flush(): push ขึ้น remote + pull การเปลี่ยนแปลงจาก remote
 *   - รวม op ซ้ำของ key เดียวกัน (save หลายครั้ง → ส่งครั้งเดียว)
 *   - trigger อัตโนมัติเมื่อกลับมาออนไลน์ (expo-network listener)
 */

import type { MemoryFact, MemoryStore, MemoryTarget, SyncResult } from './types';

export const MEMORY_NOT_IMPLEMENTED = 'Not implemented (Phase 4.5+)';

export type SyncOperation =
  | { kind: 'save'; target: MemoryTarget; fact: MemoryFact }
  | { kind: 'remove'; target: MemoryTarget; key: string }
  | { kind: 'clear'; target: MemoryTarget };

export interface PendingChange {
  id: number;
  op: SyncOperation;
  /** epoch ms */
  enqueuedAt: number;
  /** Failed flush attempts so far. */
  attempts: number;
}

export interface SyncQueue {
  /** Record a local change that the remote has not seen yet. */
  enqueue(op: SyncOperation): Promise<void>;
  /** Changes waiting to be sent, oldest first. */
  pending(): Promise<PendingChange[]>;
  /** Push pending changes to `remote` (and pull theirs). */
  flush(remote: MemoryStore): Promise<SyncResult>;
}

/** In-memory skeleton: records changes in order; flush() is not implemented yet. */
export class MemorySyncQueue implements SyncQueue {
  private readonly queue: PendingChange[] = [];
  private nextId = 1;

  async enqueue(op: SyncOperation): Promise<void> {
    this.queue.push({ id: this.nextId++, op, enqueuedAt: Date.now(), attempts: 0 });
  }

  async pending(): Promise<PendingChange[]> {
    return this.queue.map((c) => ({ ...c }));
  }

  flush(_remote: MemoryStore): Promise<SyncResult> {
    return Promise.reject(new Error(`[memory:sync] flush: ${MEMORY_NOT_IMPLEMENTED}`));
  }
}
