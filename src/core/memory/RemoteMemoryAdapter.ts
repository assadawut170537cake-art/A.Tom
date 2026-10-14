/**
 * @file Shared Memory บน server — **STUB** (ยังไม่ implement)
 *
 * ทุกเมธอด reject ด้วย {@link MEMORY_NOT_IMPLEMENTED} เพื่อให้ผู้เรียกรู้ทันทีว่ายังใช้ไม่ได้
 * (ไม่แกล้งทำเป็นสำเร็จ แล้วข้อมูลหายเงียบ ๆ)
 *
 * TODO(phase-4.5): implement remote memory
 *   1. เลือก backend + auth (ยังไม่ตัดสินใจ — ต้องมี ADR ใหม่)
 *   2. CRUD ผ่าน `request()` จาก core/http (ได้ timeout + ProviderError + redaction)
 *   3. conflict policy: last-write-wins ตาม `updatedAt` (ร่างไว้ใน ADR-011)
 *   4. ต่อกับ SyncQueue: local เขียนก่อน แล้วค่อย flush ขึ้น remote
 */

import type { MemoryFact, MemoryStore, MemoryTarget, SyncResult } from './types';

export const MEMORY_NOT_IMPLEMENTED = 'Not implemented (Phase 4.5+)';

export interface RemoteMemoryConfig {
  /** Base URL of the memory service. TODO(phase-4.5): decide the backend. */
  baseURL: string;
}

export class RemoteMemoryAdapter implements MemoryStore {
  constructor(readonly config: RemoteMemoryConfig) {}

  save(_target: MemoryTarget, _key: string, _value: string): Promise<MemoryFact> {
    return notImplemented('save');
  }

  load(_target: MemoryTarget, _key: string): Promise<MemoryFact | null> {
    return notImplemented('load');
  }

  list(_target: MemoryTarget): Promise<MemoryFact[]> {
    return notImplemented('list');
  }

  remove(_target: MemoryTarget, _key: string): Promise<boolean> {
    return notImplemented('remove');
  }

  clear(_target: MemoryTarget): Promise<void> {
    return notImplemented('clear');
  }

  sync(): Promise<SyncResult> {
    return notImplemented('sync');
  }
}

function notImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`[memory:remote] ${method}: ${MEMORY_NOT_IMPLEMENTED}`));
}
