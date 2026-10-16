/**
 * @file คิว sync แบบ offline-first ระหว่าง Shared Memory ในเครื่องกับ Mark 55 (4.5.4.2c)
 *
 * ```
 * save/remove/clear ──▶ LocalMemoryAdapter (เขียนทันที ใช้ได้แม้ออฟไลน์)
 *                   └─▶ subscribe → SyncQueue.enqueue()   (จดว่ายังไม่ได้ส่ง · persist ทุกครั้ง)
 *
 * trigger (เปิดแอปกลับมา / เน็ตกลับมา / ปุ่ม / ทุก 30s) ──▶ flush()
 *    1. pull(lastSyncAt)   → เทียบกับคิว → ใช้ฉบับที่ชนะ (applyRemote ไม่แจ้งกลับ)
 *    2. push(ที่เหลือในคิว) → server ไม่รับตัวไหน (ของ server ใหม่กว่า) → ใช้ของ server
 *    3. dequeue ที่ส่งสำเร็จ · lastSyncAt = เวลาของ server
 *    ล้ม → attempts++ แล้วลองใหม่แบบ backoff (5s → 10s → … ≤ 5 นาที) · 401 = ไม่ลองใหม่ ต้องจับคู่ใหม่
 * ```
 *
 * กติกา conflict (ตรงกับ server 4.5.4.1): ตัวตน = target + key
 * - ลบ vs แก้ → **แก้ชนะ** เสมอ
 * - อย่างอื่นเทียบ `updatedAt`: server ใหม่กว่า → ใช้ server + จด conflict · local ใหม่กว่า/เท่ากัน → push (ไม่จด)
 *
 * ไม่จับคู่ (`setRemote(null)`) = ไม่ฟังการเปลี่ยนแปลง ไม่มี timer — แอปทำงานแบบเครื่องเดียวเหมือนเดิม
 *
 * Retry ทำที่นี่ที่เดียว (RemoteMemoryAdapter ไม่ retry เอง)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { ProviderError, type ProviderErrorKind } from '../http/errors';
import { isArrayOf, isBoolean, isNumber, isRecord, isString, parseJSON } from '../types/guards';
import { isPersona } from '../types/persona';
import type { MemoryChangeListener } from './LocalMemoryAdapter';
import { syncErrorText, type PushConflict, type SyncRemote } from './RemoteMemoryAdapter';
import { slotKey, type MemoryFact, type MemoryTarget, type SyncFact } from './types';

export const SYNC_STORAGE_KEYS = {
  queue: 'mark55.sync.queue',
  lastSyncAt: 'mark55.sync.lastSyncAt',
  conflicts: 'mark55.sync.conflicts',
  autoSync: 'mark55.sync.autoSync',
} as const;

export const AUTO_SYNC_INTERVAL_MS = 30_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;
/** เก็บประวัติ conflict แค่ล่าสุดเท่านี้ (กัน AsyncStorage โต) */
export const MAX_CONFLICT_LOG = 50;

export interface SyncQueueItem extends SyncFact {
  id: string;
  /** epoch ms (เวลาเครื่อง) */
  enqueuedAt: number;
  /** flush ที่ล้มไปแล้วกี่รอบ (ขณะที่รายการนี้อยู่ในคิว) */
  attempts: number;
}

export interface ConflictLogEntry {
  id: string;
  target: MemoryTarget;
  key: string;
  /** null = ฝั่งนั้นเป็นการลบ */
  localValue: string | null;
  serverValue: string | null;
  resolvedTo: 'server' | 'local';
  /** epoch ms (เวลาเครื่อง) ที่ตัดสิน */
  at: number;
}

export interface SyncErrorInfo {
  kind: ProviderErrorKind | 'unknown';
  message: string;
  at: number;
}

export interface SyncState {
  /** มี remote (จับคู่แล้ว) */
  paired: boolean;
  /** อ่านค่าที่บันทึกไว้เสร็จแล้ว */
  restored: boolean;
  queue: readonly SyncQueueItem[];
  currentlySyncing: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMs: number;
  /** เวลาของ server ตอน sync สำเร็จล่าสุด — 0 = ยังไม่เคย */
  lastSyncAt: number;
  lastError: SyncErrorInfo | null;
  /** ใหม่สุดก่อน */
  conflicts: readonly ConflictLogEntry[];
}

export interface FlushResult {
  ok: boolean;
  /** ไม่ได้ทำ: ยังไม่จับคู่ */
  skipped?: 'unpaired';
  pushed: number;
  pulled: number;
  /** conflict ที่จดเพิ่มในรอบนี้ */
  conflicts: number;
  pending: number;
  error?: string;
}

/** ส่วนของ LocalMemoryAdapter ที่คิวต้องใช้ */
export interface SyncLocal {
  list(target: MemoryTarget): Promise<MemoryFact[]>;
  load(target: MemoryTarget, key: string): Promise<MemoryFact | null>;
  applyRemote(change: SyncFact): Promise<void>;
  subscribe(listener: MemoryChangeListener): () => void;
}

/** ตัวกระตุ้น sync จาก OS — test ใส่ตัวปลอมได้ */
export interface SyncTriggers {
  /** แอปกลับมาอยู่หน้าจอ */
  onForeground(callback: () => void): () => void;
  /** เครือข่ายกลับมา (จากออฟไลน์) */
  onOnline(callback: () => void): () => void;
}

type KeyValueStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

export interface SyncQueueDeps {
  local: SyncLocal;
  targets: readonly MemoryTarget[];
  storage?: KeyValueStorage;
  triggers?: SyncTriggers;
  now?: () => number;
  autoSyncIntervalMs?: number;
}

export const DEFAULT_TRIGGERS: SyncTriggers = {
  onForeground(callback) {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') callback();
    });
    return () => sub.remove();
  },
  onOnline(callback) {
    let wasOnline: boolean | null = null;
    const sub = Network.addNetworkStateListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online && wasOnline === false) callback();
      wasOnline = online;
    });
    return () => sub.remove();
  },
};

// ---- persisted shapes -------------------------------------------------------------------------

const isTarget = (v: unknown): v is MemoryTarget =>
  isRecord(v) && (v.scope === 'global' || (v.scope === 'persona' && isPersona(v.persona)));

const isQueueItem = (v: unknown): v is SyncQueueItem =>
  isRecord(v) &&
  isString(v.id) &&
  isTarget(v.target) &&
  isString(v.key) &&
  isString(v.value) &&
  isNumber(v.updatedAt) &&
  isBoolean(v.deleted) &&
  isNumber(v.enqueuedAt) &&
  isNumber(v.attempts);

const isNullableString = (v: unknown): v is string | null => v === null || isString(v);

const isConflict = (v: unknown): v is ConflictLogEntry =>
  isRecord(v) &&
  isString(v.id) &&
  isTarget(v.target) &&
  isString(v.key) &&
  isNullableString(v.localValue) &&
  isNullableString(v.serverValue) &&
  (v.resolvedTo === 'server' || v.resolvedTo === 'local') &&
  isNumber(v.at);

const isQueue = (v: unknown): v is SyncQueueItem[] => isArrayOf(v, isQueueItem);
const isConflictLog = (v: unknown): v is ConflictLogEntry[] => isArrayOf(v, isConflict);

/** แก้ชนะลบ; ไม่งั้นใหม่กว่าชนะ (เท่ากัน = เครื่องนี้ เพื่อส่งขึ้นไปให้ server ตัดสินซ้ำ) */
export function resolveConflict(local: SyncFact, server: SyncFact): 'server' | 'local' {
  if (local.deleted !== server.deleted) return local.deleted ? 'server' : 'local';
  return server.updatedAt > local.updatedAt ? 'server' : 'local';
}

const shouldRetry = (kind: SyncErrorInfo['kind']) =>
  kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'rate_limit' || kind === 'unknown';

let idCounter = 0;

export class SyncQueue {
  private readonly local: SyncLocal;
  private readonly targets: readonly MemoryTarget[];
  private readonly storage: KeyValueStorage;
  private readonly triggers: SyncTriggers;
  private readonly now: () => number;

  private remote: SyncRemote | null = null;
  private state: SyncState;
  private readonly listeners = new Set<() => void>();
  private running: Promise<FlushResult> | null = null;
  private restoring: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();
  private stopListening: (() => void) | null = null;
  private stopTriggers: (() => void)[] = [];
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** flush ที่ล้มติดกัน (ใช้คำนวณ backoff) */
  private failures = 0;

  constructor(deps: SyncQueueDeps) {
    this.local = deps.local;
    this.targets = deps.targets;
    this.storage = deps.storage ?? AsyncStorage;
    this.triggers = deps.triggers ?? DEFAULT_TRIGGERS;
    this.now = deps.now ?? Date.now;
    this.state = {
      paired: false,
      restored: false,
      queue: [],
      currentlySyncing: false,
      autoSyncEnabled: false,
      autoSyncIntervalMs: deps.autoSyncIntervalMs ?? AUTO_SYNC_INTERVAL_MS,
      lastSyncAt: 0,
      lastError: null,
      conflicts: [],
    };
  }

  // ---- React (useSyncExternalStore) -----------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SyncState => this.state;

  // ---- lifecycle ------------------------------------------------------------------------------

  /** อ่านคิว / lastSyncAt / conflict / ค่า auto-sync ที่บันทึกไว้ (เรียกซ้ำได้ — ได้ promise เดิม) */
  restore(): Promise<void> {
    return (this.restoring ??= this.doRestore());
  }

  private async doRestore(): Promise<void> {
    const read = async <T>(key: string, guard: (v: unknown) => v is T): Promise<T | null> => {
      try {
        const raw = await this.storage.getItem(key);
        const value = parseJSON(raw, guard);
        if (raw != null && value === null) console.error(`[sync] ${key}: ข้อมูลเสีย — ตัดทิ้ง`);
        return value;
      } catch (e) {
        console.error(`[sync] อ่าน ${key} ไม่ได้`, e);
        return null;
      }
    };
    const [queue, lastSyncAt, conflicts, autoSync] = await Promise.all([
      read(SYNC_STORAGE_KEYS.queue, isQueue),
      read(SYNC_STORAGE_KEYS.lastSyncAt, isNumber),
      read(SYNC_STORAGE_KEYS.conflicts, isConflictLog),
      read(SYNC_STORAGE_KEYS.autoSync, isBoolean),
    ]);
    // ของที่ enqueue ระหว่างรออ่าน (ใหม่กว่า) ชนะของที่บันทึกไว้
    const restoredQueue = (queue ?? []).filter((item) => !this.findItem(item.target, item.key));
    this.update({
      restored: true,
      queue: [...restoredQueue, ...this.state.queue],
      lastSyncAt: lastSyncAt ?? this.state.lastSyncAt,
      conflicts: conflicts ?? this.state.conflicts,
      autoSyncEnabled: autoSync ?? this.state.autoSyncEnabled,
    });
    this.refreshAutoTimer();
  }

  /**
   * ตั้ง remote (จับคู่แล้ว) หรือ null (ยกเลิก) — มี remote = ฟังการเปลี่ยนแปลงในเครื่อง + เปิด trigger
   * · null = หยุดทุกอย่าง (คิวยังอยู่ จนกว่าจะ `reset()`)
   */
  setRemote(remote: SyncRemote | null): void {
    this.remote = remote;
    this.failures = 0;
    this.clearRetry();
    if (remote) {
      this.stopListening ??= this.local.subscribe((change) => this.enqueue(change));
      if (this.stopTriggers.length === 0) {
        const kick = () => void this.flush();
        this.stopTriggers = [this.triggers.onForeground(kick), this.triggers.onOnline(kick)];
      }
    } else {
      this.stopListening?.();
      this.stopListening = null;
      for (const stop of this.stopTriggers) stop();
      this.stopTriggers = [];
    }
    this.update({ paired: remote !== null, lastError: null });
    this.refreshAutoTimer();
  }

  /** หยุด timer / listener ทั้งหมด (ใช้ตอน test หรือปิดแอป) */
  dispose(): void {
    this.setRemote(null);
  }

  /** ล้างคิว + lastSyncAt + conflict (ตอนยกเลิกการจับคู่ — server ใหม่ต้องเริ่มจากศูนย์) */
  async reset(): Promise<void> {
    this.update({ queue: [], lastSyncAt: 0, conflicts: [], lastError: null });
    await this.persist([SYNC_STORAGE_KEYS.queue, SYNC_STORAGE_KEYS.lastSyncAt, SYNC_STORAGE_KEYS.conflicts]);
  }

  // ---- queue ----------------------------------------------------------------------------------

  /** จดการเปลี่ยนแปลง — key เดียวกันซ้ำ = แทนของเดิม (ส่งแค่ฉบับล่าสุด) · persist ทันที */
  enqueue(change: SyncFact): SyncQueueItem {
    const item: SyncQueueItem = {
      target: change.target,
      key: change.key,
      value: change.deleted ? '' : change.value,
      updatedAt: change.updatedAt,
      deleted: change.deleted,
      id: `sync-${this.now().toString(36)}-${(idCounter++).toString(36)}`,
      enqueuedAt: this.now(),
      attempts: 0,
    };
    const slot = slotKey(change.target, change.key);
    this.update({ queue: [...this.state.queue.filter((q) => slotKey(q.target, q.key) !== slot), item] });
    void this.persist([SYNC_STORAGE_KEYS.queue]);
    return item;
  }

  /** เอาออกจากคิว (หลังส่งสำเร็จ) — false = ไม่มีแล้ว (เช่น ถูกแทนด้วยการแก้ใหม่กว่า) */
  dequeue(id: string): boolean {
    const queue = this.state.queue.filter((q) => q.id !== id);
    if (queue.length === this.state.queue.length) return false;
    this.update({ queue });
    void this.persist([SYNC_STORAGE_KEYS.queue]);
    return true;
  }

  /** ใส่ทุก fact ในเครื่องเข้าคิว — ใช้ตอนจับคู่ครั้งแรก เพื่อให้ของที่มีอยู่ก่อนจับคู่ขึ้น server ด้วย */
  async enqueueAll(): Promise<number> {
    let count = 0;
    for (const target of this.targets) {
      for (const fact of await this.local.list(target)) {
        if (this.findItem(target, fact.key)) continue; // มีการแก้ใหม่กว่ารออยู่แล้ว
        this.enqueue({ target, key: fact.key, value: fact.value, updatedAt: fact.updatedAt, deleted: false });
        count++;
      }
    }
    return count;
  }

  async setAutoSync(enabled: boolean): Promise<void> {
    this.update({ autoSyncEnabled: enabled });
    this.refreshAutoTimer();
    await this.persist([SYNC_STORAGE_KEYS.autoSync]);
  }

  async clearConflicts(): Promise<void> {
    this.update({ conflicts: [] });
    await this.persist([SYNC_STORAGE_KEYS.conflicts]);
  }

  // ---- flush ----------------------------------------------------------------------------------

  /** ส่ง/รับกับ server — เรียกซ้อนกันได้ (ได้รอบเดียวกัน) · ไม่ reject: ผลล้มอยู่ใน `error` + `lastError` */
  flush(): Promise<FlushResult> {
    if (this.running) return this.running;
    const run = this.doFlush().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async doFlush(): Promise<FlushResult> {
    const remote = this.remote;
    if (!remote) return { ok: false, skipped: 'unpaired', pushed: 0, pulled: 0, conflicts: 0, pending: this.state.queue.length };
    await this.restore();
    this.clearRetry();
    this.update({ currentlySyncing: true });
    let pulled = 0;
    let pushed = 0;
    let conflicts = 0;
    try {
      // 1. pull — ใช้ของ server ที่ชนะ
      const pull = await remote.pull(this.state.lastSyncAt);
      let serverTime = pull.serverTimestamp;
      for (const server of pull.facts) {
        const outcome = await this.applyPulled(server);
        if (outcome !== 'skipped') pulled++;
        if (outcome === 'conflict') conflicts++;
      }

      // 2. push ที่เหลือในคิว
      const batch = [...this.state.queue];
      if (batch.length > 0) {
        const res = await remote.push(batch.map(toSyncFact), this.state.lastSyncAt);
        serverTime = res.serverTimestamp;
        for (const conflict of res.conflicts) {
          if (await this.applyRejected(conflict, batch)) conflicts++;
        }
        const rejected = new Set(res.conflicts.map((c) => slotKey(c.target, c.key)));
        for (const item of batch) {
          // dequeue ไม่สนว่าถูกปฏิเสธไหม: ถ้าปฏิเสธ เราใช้ของ server แล้ว — ไม่ต้องส่งซ้ำ
          if (this.dequeue(item.id) && !rejected.has(slotKey(item.target, item.key))) pushed++;
        }
      }

      this.failures = 0;
      this.update({ lastSyncAt: serverTime, lastError: null });
      await this.persist([SYNC_STORAGE_KEYS.lastSyncAt, SYNC_STORAGE_KEYS.queue]);
      return { ok: true, pushed, pulled, conflicts, pending: this.state.queue.length };
    } catch (e) {
      const error = this.recordFailure(e);
      return { ok: false, pushed, pulled, conflicts, pending: this.state.queue.length, error: error.message };
    } finally {
      this.update({ currentlySyncing: false });
    }
  }

  /** ผลของ fact หนึ่งตัวจาก pull */
  private async applyPulled(server: SyncFact): Promise<'applied' | 'conflict' | 'skipped'> {
    const pending = this.findItem(server.target, server.key);
    if (pending) {
      if (resolveConflict(pending, server) === 'local') return 'skipped'; // ส่งของเราขึ้นไปใน push
      this.dequeue(pending.id);
      await this.local.applyRemote(server);
      if (pending.deleted && server.deleted) return 'applied';
      if (!pending.deleted && !server.deleted && pending.value === server.value) return 'applied';
      this.logConflict(pending, server);
      return 'conflict';
    }
    // ไม่มีการแก้ค้างในเครื่อง → ปกติ server ถูกเสมอ (เว้นของเราใหม่กว่าจริง ๆ — กันไว้ก่อน ส่งขึ้นไปแทน)
    const mine = await this.local.load(server.target, server.key);
    if (mine && mine.updatedAt > server.updatedAt) {
      this.enqueue({ target: server.target, key: server.key, value: mine.value, updatedAt: mine.updatedAt, deleted: false });
      return 'skipped';
    }
    if (server.deleted ? !mine : mine?.value === server.value && mine.updatedAt === server.updatedAt) {
      return 'skipped'; // ตรงกันอยู่แล้ว (เช่น ของที่เราเพิ่ง push แล้ว server ส่งกลับมา)
    }
    await this.local.applyRemote(server);
    return 'applied';
  }

  /** server ไม่รับ fact ที่ push เพราะของ server ใหม่กว่า → ใช้ของ server + จด conflict */
  private async applyRejected(conflict: PushConflict, batch: readonly SyncQueueItem[]): Promise<boolean> {
    const mine = batch.find((q) => slotKey(q.target, q.key) === slotKey(conflict.target, conflict.key));
    if (!mine || !conflict.server) return false;
    // ระหว่างรอ push บอสอาจแก้ key นี้อีก — ฉบับใหม่นั้นยังต้องส่ง อย่าเขียนทับ
    const newer = this.findItem(conflict.target, conflict.key);
    if (newer && newer.id !== mine.id) return false;
    await this.local.applyRemote(conflict.server);
    this.logConflict(mine, conflict.server);
    return true;
  }

  private logConflict(local: SyncFact, server: SyncFact): void {
    const entry: ConflictLogEntry = {
      id: `conflict-${this.now().toString(36)}-${(idCounter++).toString(36)}`,
      target: local.target,
      key: local.key,
      localValue: local.deleted ? null : local.value,
      serverValue: server.deleted ? null : server.value,
      resolvedTo: 'server',
      at: this.now(),
    };
    this.update({ conflicts: [entry, ...this.state.conflicts].slice(0, MAX_CONFLICT_LOG) });
    void this.persist([SYNC_STORAGE_KEYS.conflicts]);
  }

  private recordFailure(e: unknown): SyncErrorInfo {
    const kind = e instanceof ProviderError ? e.kind : 'unknown';
    const error: SyncErrorInfo = { kind, message: syncErrorText(e), at: this.now() };
    if (kind === 'unknown') console.error('[sync] ซิงก์ไม่สำเร็จ', e);
    this.failures++;
    const queue = this.state.queue.map((q) => ({ ...q, attempts: q.attempts + 1 }));
    this.update({ lastError: error, queue });
    void this.persist([SYNC_STORAGE_KEYS.queue]);
    if (shouldRetry(kind)) this.scheduleRetry();
    return error;
  }

  // ---- timers ---------------------------------------------------------------------------------

  /** หน่วงก่อนลองใหม่ครั้งที่ n (1-based): 5s, 10s, 20s, … ไม่เกิน 5 นาที */
  static retryDelay(failures: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (!this.remote) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, SyncQueue.retryDelay(this.failures));
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private refreshAutoTimer(): void {
    const want = this.remote !== null && this.state.autoSyncEnabled;
    if (want && !this.autoTimer) {
      this.autoTimer = setInterval(() => void this.flush(), this.state.autoSyncIntervalMs);
    } else if (!want && this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  // ---- internals ------------------------------------------------------------------------------

  private findItem(target: MemoryTarget, key: string): SyncQueueItem | undefined {
    const slot = slotKey(target, key);
    return this.state.queue.find((q) => slotKey(q.target, q.key) === slot);
  }

  private update(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** เขียนค่าปัจจุบันของ key ที่ระบุ — ต่อคิวกันเขียนสลับลำดับ · ล้มแค่ log (คิวในหน่วยความจำยังใช้ได้) */
  private persist(keys: readonly (typeof SYNC_STORAGE_KEYS)[keyof typeof SYNC_STORAGE_KEYS][]): Promise<void> {
    const write = async () => {
      for (const key of keys) {
        try {
          // ค่าอ่าน ณ ตอนเขียน (ไม่ใช่ตอนสั่ง) → เขียนช้าก็ไม่ทับค่าที่ใหม่กว่า
          await this.storage.setItem(key, JSON.stringify(this.valueFor(key)));
        } catch (e) {
          console.error(`[sync] บันทึก ${key} ไม่สำเร็จ — ปิดแอปแล้วอาจต้องซิงก์ใหม่`, e);
        }
      }
    };
    const next = this.writeChain.then(write);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private valueFor(key: (typeof SYNC_STORAGE_KEYS)[keyof typeof SYNC_STORAGE_KEYS]): unknown {
    switch (key) {
      case SYNC_STORAGE_KEYS.queue:
        return this.state.queue;
      case SYNC_STORAGE_KEYS.lastSyncAt:
        return this.state.lastSyncAt;
      case SYNC_STORAGE_KEYS.conflicts:
        return this.state.conflicts;
      case SYNC_STORAGE_KEYS.autoSync:
        return this.state.autoSyncEnabled;
    }
  }
}

function toSyncFact({ target, key, value, updatedAt, deleted }: SyncQueueItem): SyncFact {
  return { target, key, value, updatedAt, deleted };
}
