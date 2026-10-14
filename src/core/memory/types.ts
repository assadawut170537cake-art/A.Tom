/**
 * @file Shared Memory — ความจำระยะยาวที่ทุก module / handler ใช้ร่วมกัน (Phase 4 scaffold)
 *
 * "fact" หนึ่งชิ้น = ข้อเท็จจริงสั้น ๆ แบบ key → value เช่น `nickname → "ต้น"`
 * แยกขอบเขตได้ 2 แบบ:
 *
 * - `global` — ทุก persona เห็นร่วมกัน (เรื่องของบอส)
 * - `persona` — เฉพาะ persona นั้น (เช่น มุกที่อะตอมกับบอสใช้กันเอง)
 *
 * Implementation:
 * - {@link ./LocalMemoryAdapter} — AsyncStorage, ใช้งานได้แล้ว
 * - {@link ./RemoteMemoryAdapter} — stub (Phase 4.5+)
 * - {@link ./SyncQueue} — skeleton ของคิว offline-first (Phase 4.5+)
 *
 * @see ../../../docs/DECISIONS.md — ADR-011
 */

import { PERSONA_IDS, type Persona } from '../types/persona';

export type MemoryScope = 'global' | 'persona';

/** Where a fact lives: shared by everyone, or private to one persona. */
export type MemoryTarget = { scope: 'global' } | { scope: 'persona'; persona: Persona };

/** Who wrote the fact: the user, an assistant reply, the app itself, or a module id. */
export type MemorySource = 'user' | 'assistant' | 'system' | `module:${string}`;

export interface MemoryFact {
  /** Stable across updates of the same key. */
  id: string;
  key: string;
  value: string;
  source: MemorySource;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Changes still waiting for a remote (always 0 for a local-only store). */
  pending: number;
}

export interface MemoryStore {
  /** Create or update `key` (keeps `id` and `createdAt` of an existing fact). */
  save(target: MemoryTarget, key: string, value: string, source?: MemorySource): Promise<MemoryFact>;
  /** The fact for `key`, or null when it doesn't exist. */
  load(target: MemoryTarget, key: string): Promise<MemoryFact | null>;
  /** Every fact in the target, oldest first. */
  list(target: MemoryTarget): Promise<MemoryFact[]>;
  /** Delete one fact; true when something was removed. */
  remove(target: MemoryTarget, key: string): Promise<boolean>;
  /** Delete every fact in the target. */
  clear(target: MemoryTarget): Promise<void>;
  /** Reconcile with a remote copy (no-op for local-only stores). */
  sync(): Promise<SyncResult>;
}

/** Keys become part of a storage key, so they are restricted to a safe, dot-free alphabet. */
export const MEMORY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Storage segment for a target: `global` or `persona.<n>`. */
export function scopeSegment(target: MemoryTarget): string {
  return target.scope === 'global' ? 'global' : `persona.${target.persona}`;
}

/** ทุกขอบเขตที่มี: global + แต่ละ persona (ใช้ตอนไล่อ่าน fact ทั้งหมด เช่น Memory UI / boot) */
export const ALL_MEMORY_TARGETS: readonly MemoryTarget[] = [
  { scope: 'global' },
  ...PERSONA_IDS.map((persona): MemoryTarget => ({ scope: 'persona', persona })),
];
