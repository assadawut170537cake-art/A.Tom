import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Message, Persona } from '../../features/jarvis/types';

/**
 * Chat history persistence: one AsyncStorage key per persona so histories stay separate and a
 * save only rewrites the persona that changed. Storage failures never throw to callers — they
 * report `false` and the app keeps working from memory.
 */

const KEY_PREFIX = 'atom.history.v1.';
const PERSONAS: Persona[] = [1, 2, 3, 4];
const ROLES = new Set(['user', 'assistant', 'system']);

/** Newest messages kept per persona (keeps AsyncStorage well under Android's size limit). */
export const MAX_STORED_MESSAGES = 500;

export const historyKey = (persona: Persona) => `${KEY_PREFIX}${persona}`;

function isMessage(value: unknown, persona: Persona): value is Message {
  const m = value as Partial<Message> | null;
  return (
    !!m &&
    typeof m.id === 'string' &&
    typeof m.content === 'string' &&
    typeof m.createdAt === 'number' &&
    ROLES.has(m.role as string) &&
    m.persona === persona
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
      const persona = Number(key.slice(KEY_PREFIX.length)) as Persona;
      if (!raw || !PERSONAS.includes(persona)) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) histories[persona] = parsed.filter((m) => isMessage(m, persona));
      } catch {
        // corrupt entry → start that persona fresh
      }
    }
    return { ok: true, histories };
  },
};
