import AsyncStorage from '@react-native-async-storage/async-storage';

// NOTE(arch, 2026-10-14): core/ imports *types* from features/ (type-only, no runtime cycle).
// Moving Persona/Message/provider-id types into core/ would make the dependency one-way; deferred
// because it touches most feature files — revisit before Phase 4 adds more storage.
import type { Message, Persona } from '../../features/jarvis/types';
import { isArray, isOneOf, isRecord, isString, parseJSON } from '../types/guards';

/**
 * Chat history persistence: one AsyncStorage key per persona so histories stay separate and a
 * save only rewrites the persona that changed. Storage failures never throw to callers — they
 * report `false` and the app keeps working from memory.
 */

const KEY_PREFIX = 'atom.history.v1.';
const PERSONAS = [1, 2, 3, 4] as const satisfies readonly Persona[];
const ROLES = ['user', 'assistant', 'system'] as const satisfies readonly Message['role'][];

/** Newest messages kept per persona (keeps AsyncStorage well under Android's size limit). */
export const MAX_STORED_MESSAGES = 500;

export const historyKey = (persona: Persona) => `${KEY_PREFIX}${persona}`;

function isMessage(value: unknown, persona: Persona): value is Message {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.content) &&
    typeof value.createdAt === 'number' &&
    isOneOf(ROLES, value.role) &&
    value.persona === persona
  );
}

/** Per-persona write queue so saves land in order and never interleave. */
const queues = new Map<Persona, Promise<boolean>>();

export const ChatHistoryStorage = {
  /** Saves one persona's history (trimmed to the newest MAX_STORED_MESSAGES). */
  save(persona: Persona, messages: Message[]): Promise<boolean> {
    const snapshot = JSON.stringify(messages.slice(-MAX_STORED_MESSAGES));
    const next = (queues.get(persona) ?? Promise.resolve(true)).then(async () => {
      try {
        await AsyncStorage.setItem(historyKey(persona), snapshot);
        return true;
      } catch {
        return false;
      }
    });
    queues.set(persona, next);
    return next;
  },

  /**
   * Loads every persona's history. Corrupt or unreadable entries become empty histories;
   * `ok` is false when storage itself failed (caller should treat history as memory-only).
   */
  async loadAll(): Promise<{ ok: boolean; histories: Record<Persona, Message[]> }> {
    const histories: Record<Persona, Message[]> = { 1: [], 2: [], 3: [], 4: [] };
    let entries: readonly (readonly [string, string | null])[];
    try {
      entries = await AsyncStorage.multiGet(PERSONAS.map(historyKey));
    } catch {
      return { ok: false, histories };
    }
    for (const [key, raw] of entries) {
      const persona = Number(key.slice(KEY_PREFIX.length));
      if (!isOneOf(PERSONAS, persona)) continue;
      // Missing/corrupt entry → that persona starts fresh; invalid messages are dropped
      const parsed = parseJSON(raw, isArray);
      if (parsed) histories[persona] = parsed.filter((m) => isMessage(m, persona));
    }
    return { ok: true, histories };
  },
};
