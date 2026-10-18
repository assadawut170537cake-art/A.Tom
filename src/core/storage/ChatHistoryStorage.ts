/**
 * @file เก็บประวัติแชทถาวร แยกต่อ persona (AsyncStorage)
 *
 * - หนึ่ง key ต่อ persona: `atom.history.v1.<1-4>` → บันทึกเฉพาะ persona ที่เปลี่ยน
 * - เก็บล่าสุดไม่เกิน {@link MAX_STORED_MESSAGES} ข้อความต่อ persona
 * - คิวการเขียนต่อ persona → บันทึกถี่ ๆ ก็ลงตามลำดับ ไม่ทับกัน
 * - **ไม่ throw ใส่ผู้เรียก**: เขียนไม่ได้ → `save()` คืน `false` · อ่านไม่ได้ → `loadAll()` คืน `ok: false`
 *   (store จะตั้ง `historyPersisted = false` และทำงานในหน่วยความจำต่อ)
 * - ข้อมูลเสีย (JSON พัง / ไม่ใช่ array / ข้อความผิดรูปแบบ) → ตัดทิ้งพร้อม `console.error`
 *
 * ผู้ใช้หลัก: `useAtomStore` (`pushMessage` → `save`, `loadHistory` → `loadAll`)
 *
 * @see ../../../docs/DECISIONS.md — ADR-003 ประวัติแชทแยกต่อ persona และเก็บถาวร
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isArray, isArrayOf, isOneOf, isRecord, isString, parseJSON } from '../types/guards';
import { MESSAGE_ROLES, isAttachment, type Message } from '../types/message';
import { PERSONA_IDS, isPersona, type Persona } from '../types/persona';

/**
 * Chat history persistence: one AsyncStorage key per persona so histories stay separate and a
 * save only rewrites the persona that changed. Storage failures never throw to callers — they
 * report `false` and the app keeps working from memory.
 */

const KEY_PREFIX = 'atom.history.v1.';

/** Newest messages kept per persona (keeps AsyncStorage well under Android's size limit). */
export const MAX_STORED_MESSAGES = 500;

export const historyKey = (persona: Persona) => `${KEY_PREFIX}${persona}`;

function isMessage(value: unknown, persona: Persona): value is Message {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.content) &&
    typeof value.createdAt === 'number' &&
    isOneOf(MESSAGE_ROLES, value.role) &&
    value.persona === persona &&
    (value.attachments === undefined || isArrayOf(value.attachments, isAttachment))
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
      } catch (e) {
        console.error(`[history] บันทึกประวัติแชทของ persona ${persona} ไม่ได้ — เก็บไว้ในหน่วยความจำ`, e);
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
      entries = await AsyncStorage.multiGet(PERSONA_IDS.map(historyKey));
    } catch (e) {
      console.error('[history] อ่านประวัติแชทไม่ได้ — เริ่มใหม่ในหน่วยความจำ', e);
      return { ok: false, histories };
    }
    for (const [key, raw] of entries) {
      const persona = Number(key.slice(KEY_PREFIX.length));
      if (!isPersona(persona)) continue;
      if (raw == null) continue;
      // Corrupt entry → that persona starts fresh; invalid messages are dropped
      const parsed = parseJSON(raw, isArray);
      if (!parsed) {
        console.error(`[history] ${key}: ข้อมูลเสีย — ตัดทิ้งทั้งชุด`);
        continue;
      }
      const valid = parsed.filter((m) => isMessage(m, persona));
      if (valid.length < parsed.length) {
        console.error(`[history] ${key}: ตัดข้อความที่เสียทิ้ง ${parsed.length - valid.length} รายการ`);
      }
      histories[persona] = valid;
    }
    return { ok: true, histories };
  },
};
