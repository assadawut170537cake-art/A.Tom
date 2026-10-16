/**
 * Mark 55 ปลอมสำหรับ test ของ SyncQueue / MemorySync / SyncScreen — อยู่นอก __tests__ เพื่อไม่ให้ Jest เก็บเป็นไฟล์ test
 */

import type {
  PullResult,
  PushResult,
  RemoteMemoryAdapter,
  SyncRemote,
  VerifyResult,
} from '../core/memory/RemoteMemoryAdapter';
import { ProviderError } from '../core/http/errors';
import type { SyncFact } from '../core/memory/types';

/** remote ปลอม: เก็บสิ่งที่ถูก push · ตั้งผล pull/push ต่อรอบได้ */
export function fakeRemote() {
  const pulls: number[] = [];
  const pushes: { facts: SyncFact[]; lastSyncAt: number }[] = [];
  let pullFacts: SyncFact[] = [];
  let pushConflicts: PushResult['conflicts'] = [];
  let failWith: unknown = null;
  let serverTime = 1_000_000;
  const remote: SyncRemote = {
    pull: jest.fn(async (since: number): Promise<PullResult> => {
      pulls.push(since);
      if (failWith) throw failWith;
      const facts = pullFacts;
      pullFacts = [];
      return { facts, serverTimestamp: ++serverTime };
    }),
    push: jest.fn(async (facts: SyncFact[], lastSyncAt: number): Promise<PushResult> => {
      pushes.push({ facts, lastSyncAt });
      const conflicts = pushConflicts;
      pushConflicts = [];
      return { applied: facts.length - conflicts.length, conflicts, serverTimestamp: ++serverTime };
    }),
  };
  return {
    remote,
    pulls,
    pushes,
    serverPulls: (facts: SyncFact[]) => void (pullFacts = facts),
    serverRejects: (conflicts: PushResult['conflicts']) => void (pushConflicts = conflicts),
    failWith: (e: unknown) => void (failWith = e),
  };
}

/** RemoteMemoryAdapter ปลอม (pull/push จาก `fakeRemote` + pair/verify/health ที่ตั้งผลได้) */
export function remoteStub(remote: SyncRemote) {
  const stub = {
    pull: remote.pull,
    push: remote.push,
    pair: jest.fn(async (_code: string, _deviceName: string) => ({ token: 'jwt', expiresAt: 2_000_000 })),
    verify: jest.fn(async (): Promise<VerifyResult> => ({ valid: true, deviceName: 'Pixel', expiresAt: 2_000_000 })),
    health: jest.fn(async () => ({ status: 'ok', version: '0.1.0', uptime: 1 })),
  };
  // test double: MemorySync เรียกแค่เมธอดข้างบน — ไม่ต้องสร้าง RemoteMemoryAdapter จริง (มี field private)
  return stub as unknown as RemoteMemoryAdapter & typeof stub;
}

/** SecureStore ในหน่วยความจำ (แยกต่อ test) */
export function fakeSecureStore() {
  const store = new Map<string, string>();
  return {
    store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
}

/**
 * Mark 55 จำลองตามกติกาของ server 4.5.4.1 — ใช้ทดสอบว่าหลายเครื่องซิงก์แล้วได้ข้อมูลตรงกัน
 *
 * - ตัวตน = target + key · เก็บ tombstone (`deleted: true`) ไว้ส่งต่อให้เครื่องอื่น
 * - push: ฉบับบน server ที่ client **เคยเห็นแล้ว** (`syncedAt <= lastSyncAt`) = ไม่ขัดแย้ง → รับของใหม่เลย
 *   (ไม่งั้นการลบจะไม่มีวันไปถึงเครื่องอื่น) · ฉบับที่ client ยังไม่เห็น = ขัดแย้งจริง → แก้ชนะลบ ·
 *   ไม่งั้นรับเมื่อ `updatedAt` ใหม่กว่า (เท่ากัน = เก็บของเดิม + ตอบ conflict)
 * - `updatedAt` เกินเวลา server ไป 1 วัน → 400 (clock skew)
 * - ทุกฉบับที่รับ ได้ `syncedAt` = เวลา server · pull คืนเฉพาะ `syncedAt > since`
 */
export class FakeMark55Server {
  /** เวลา server (epoch ms) — test เลื่อนเองได้ */
  now = 1_000_000;
  private readonly rows = new Map<string, { fact: SyncFact; syncedAt: number }>();

  private slot = (f: Pick<SyncFact, 'target' | 'key'>) =>
    f.target.scope === 'global' ? `global.${f.key}` : `persona.${f.target.persona}.${f.key}`;

  /** ฉบับปัจจุบันของ key (รวม tombstone) */
  get(target: SyncFact['target'], key: string): SyncFact | undefined {
    return this.rows.get(this.slot({ target, key }))?.fact;
  }

  /** เขียนตรง ๆ เหมือนเครื่องอื่น push เข้ามา */
  seed(fact: SyncFact): void {
    this.rows.set(this.slot(fact), { fact, syncedAt: ++this.now });
  }

  /** client ของเครื่องหนึ่ง */
  client(): SyncRemote {
    return {
      pull: async (since) => ({
        facts: [...this.rows.values()].filter((r) => r.syncedAt > since).map((r) => r.fact),
        serverTimestamp: ++this.now,
      }),
      push: async (facts, lastSyncAt) => {
        if (facts.some((f) => f.updatedAt > this.now + 24 * 60 * 60 * 1000)) {
          throw new ProviderError('mark55', 'bad_request', 'Mark 55 ไม่รับคำขอนี้ (updatedAt ล้ำเวลา server เกิน 1 วัน)', 400);
        }
        let applied = 0;
        const conflicts: PushResult['conflicts'] = [];
        for (const incoming of facts) {
          const row = this.rows.get(this.slot(incoming));
          const existing = row?.fact;
          const concurrent = row !== undefined && row.syncedAt > lastSyncAt;
          const wins =
            !existing ||
            !concurrent ||
            (existing.deleted !== incoming.deleted ? !incoming.deleted : incoming.updatedAt > existing.updatedAt);
          if (wins) {
            this.rows.set(this.slot(incoming), { fact: incoming, syncedAt: ++this.now });
            applied++;
          } else {
            conflicts.push({ target: incoming.target, key: incoming.key, server: existing });
          }
        }
        return { applied, conflicts, serverTimestamp: ++this.now };
      },
    };
  }
}
