/**
 * @file ส่ง Shared Memory fact ขึ้น Supermemory (space ร่วมของทีม: F.R.I.D.A.Y. / DeepSeek / Claude อ่านได้)
 *
 * - ฟัง `LocalMemoryAdapter.subscribe()` → fact ที่เพิ่ม/แก้ในเครื่อง = `POST /v3/documents` หนึ่งครั้ง
 * - **Fail-open:** ทุกอย่างทำเบื้องหลัง ไม่ reject ไม่ throw — เน็ตหลุด / key ผิด / Supermemory ล่ม แค่ log
 *   (save() ของ memory และแชทไม่รอผลจากที่นี่เลย)
 * - API key: SecureStore เท่านั้น (`atom.secret.supermemory.apiKey` ผ่าน SecureKeyStore) · ไม่มี key = ไม่ส่งอะไร
 * - การลบไม่ถูกส่ง: Supermemory ลบได้ด้วย document id ซึ่งเครื่องไม่ได้จดไว้ (สเปกนี้ส่งเพิ่มอย่างเดียว)
 * - ของที่ดึงจาก Mark 55 (`applyRemote`) ไม่แจ้ง listener → ไม่ถูกส่งซ้ำจากเครื่องนี้
 * - ไม่มี retry / คิวถาวร — ส่งไม่ผ่านก็ทิ้ง (Supermemory เป็นสำเนาเพื่ออ่าน ข้อมูลจริงอยู่ในเครื่อง + Mark 55)
 */

import { redactSecrets } from '../http/errors';
import { request } from '../http/request';
import { SecureKeyStore, type KeyStore } from '../storage/SecureKeyStore';
import { localMemory } from './LocalMemoryAdapter';
import { toPromptLine } from './promptLine';
import { scopeSegment, type SyncFact } from './types';

export const SUPERMEMORY_ENDPOINT = 'https://api.supermemory.ai/v3/documents';
/** space ร่วมจริงของทีม (`atom_core` เปล่า ๆ เป็นอีก space ที่ว่าง) */
export const SUPERMEMORY_CONTAINER_TAG = 'project_atom_memory_base_4folders_atom_core';
/** ชื่อใน SecureKeyStore (เก็บจริงที่ `atom.secret.supermemory.apiKey`) */
export const SUPERMEMORY_KEY_NAME = 'supermemory.apiKey';
export const SUPERMEMORY_TIMEOUT_MS = 10_000;
/** ยาวพอสำหรับ value สูงสุด (200) + key + ขอบเขต */
const MAX_CONTENT_LENGTH = 320;

export type SuperMemoryPushResult = 'sent' | 'skipped' | 'failed';

export interface SuperMemorySyncDeps {
  local: { subscribe(listener: (change: SyncFact) => void): () => void };
  keyStore?: Pick<KeyStore, 'get'>;
  timeoutMs?: number;
}

/** ข้อความหนึ่งบรรทัดที่ส่งขึ้นไป — บีบผ่าน toPromptLine() เพราะ agent อื่นอาจเอาไปใส่ prompt ต่อ */
export function factContent(change: Pick<SyncFact, 'target' | 'key' | 'value'>): string {
  return toPromptLine(`[A.T.O.M. memory · ${scopeSegment(change.target)}] ${change.key}: ${change.value}`, MAX_CONTENT_LENGTH);
}

export class SuperMemorySyncService {
  private readonly keyStore: Pick<KeyStore, 'get'>;
  private readonly timeoutMs: number;
  private unsubscribe: (() => void) | null = null;
  /** ส่งทีละรายการตามลำดับที่แก้ — กันฉบับเก่าไปถึงทีหลังฉบับใหม่ */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SuperMemorySyncDeps) {
    this.keyStore = deps.keyStore ?? SecureKeyStore;
    this.timeoutMs = deps.timeoutMs ?? SUPERMEMORY_TIMEOUT_MS;
  }

  /** เริ่มฟังการเปลี่ยนแปลง · เรียกซ้ำได้ (fast refresh) */
  start(): void {
    this.unsubscribe ??= this.deps.local.subscribe((change) => {
      if (change.deleted) return;
      void this.enqueue(change);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** รอให้รายการที่ค้างส่งเสร็จ (ใช้ใน test / ก่อนปิด) — ไม่ reject */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** ส่ง fact เดียว — ไม่ reject เด็ดขาด */
  enqueue(change: SyncFact): Promise<SuperMemoryPushResult> {
    const run = this.chain.then(() => this.push(change));
    this.chain = run;
    return run;
  }

  private async push(change: SyncFact): Promise<SuperMemoryPushResult> {
    try {
      const apiKey = (await this.keyStore.get(SUPERMEMORY_KEY_NAME))?.trim();
      if (!apiKey) return 'skipped';
      await request('supermemory', SUPERMEMORY_ENDPOINT, {
        method: 'POST',
        timeoutMs: this.timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: factContent(change),
          containerTag: SUPERMEMORY_CONTAINER_TAG,
          dreaming: 'instant',
        }),
      });
      return 'sent';
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[supermemory] ส่ง "${change.key}" ไม่สำเร็จ — ข้ามไป (แชททำงานต่อปกติ): ${redactSecrets(reason)}`);
      return 'failed';
    }
  }
}

/** ตัวเดียวทั้งแอป — ฟัง Shared Memory ตัวเดียวกับ ChatHandler / แท็บ Memory · boot เรียก `start()` */
export const superMemorySync = new SuperMemorySyncService({ local: localMemory });
