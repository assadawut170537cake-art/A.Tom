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
