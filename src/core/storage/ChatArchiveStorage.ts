/**
 * @file ห้องแชทเก่า (หลายห้องต่อ persona) — AsyncStorage `atom.chats.v1.<1-4>`
 *
 * ห้องที่กำลังคุยยังอยู่ที่ `atom.history.v1.<persona>` เหมือนเดิม (lock decision 8 ไม่เปลี่ยน)
 * กด "แชทใหม่" → ห้องปัจจุบันถูกย้ายมาเก็บที่นี่ · เปิดห้องเก่า → สลับกับห้องปัจจุบัน
 *
 * ไม่ throw ใส่ผู้เรียก เหมือน ChatHistoryStorage: เขียนไม่ได้ → `false` · อ่านไม่ได้ → ห้องว่าง
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isArray, isArrayOf, isOneOf, isRecord, isString, parseJSON } from '../types/guards';
import { MESSAGE_ROLES, isAttachment, isMemorySuggestion, type Message } from '../types/message';
import { PERSONA_IDS, isPersona, type Persona } from '../types/persona';
import { MAX_STORED_MESSAGES } from './ChatHistoryStorage';

const KEY_PREFIX = 'atom.chats.v1.';

/** ห้องเก่าที่เก็บได้ต่อ persona — เกินนี้ห้องที่ไม่ได้แตะนานสุดถูกตัด */
export const MAX_ARCHIVED_CHATS = 50;
const TITLE_LENGTH = 40;

export interface ChatArchive {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export const archiveKey = (persona: Persona) => `${KEY_PREFIX}${persona}`;

/** ชื่อห้อง = ข้อความแรกของบอส (ตัดให้สั้น) */
export function chatTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user')?.content ?? messages[0]?.content ?? 'แชท';
  const oneLine = first.replace(/\s+/g, ' ').trim();
  return oneLine.length > TITLE_LENGTH ? `${oneLine.slice(0, TITLE_LENGTH)}…` : oneLine || 'แชท';
}

function isMessage(value: unknown, persona: Persona): value is Message {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.content) &&
    typeof value.createdAt === 'number' &&
    isOneOf(MESSAGE_ROLES, value.role) &&
    value.persona === persona &&
    (value.attachments === undefined || isArrayOf(value.attachments, isAttachment)) &&
    (value.memorySuggestions === undefined || isArrayOf(value.memorySuggestions, isMemorySuggestion))
  );
}

function toArchive(value: unknown, persona: Persona): ChatArchive | null {
  if (!isRecord(value) || !isString(value.id) || !isArray(value.messages)) return null;
  const messages = value.messages.filter((m) => isMessage(m, persona));
  if (!messages.length) return null;
  return {
    id: value.id,
    title: isString(value.title) ? value.title : chatTitle(messages),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : (messages[0]?.createdAt ?? 0),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : (messages.at(-1)?.createdAt ?? 0),
    messages,
  };
}

const queues = new Map<Persona, Promise<boolean>>();

export const ChatArchiveStorage = {
  save(persona: Persona, chats: ChatArchive[]): Promise<boolean> {
    const trimmed = [...chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ARCHIVED_CHATS)
      .map((c) => ({ ...c, messages: c.messages.slice(-MAX_STORED_MESSAGES) }));
    const snapshot = JSON.stringify(trimmed);
    const next = (queues.get(persona) ?? Promise.resolve(true)).then(async () => {
      try {
        await AsyncStorage.setItem(archiveKey(persona), snapshot);
        return true;
      } catch (e) {
        console.error(`[chats] บันทึกห้องแชทเก่าของ persona ${persona} ไม่ได้`, e);
        return false;
      }
    });
    queues.set(persona, next);
    return next;
  },

  async loadAll(): Promise<Record<Persona, ChatArchive[]>> {
    const result: Record<Persona, ChatArchive[]> = { 1: [], 2: [], 3: [], 4: [] };
    let entries: readonly (readonly [string, string | null])[];
    try {
      entries = await AsyncStorage.multiGet(PERSONA_IDS.map(archiveKey));
    } catch (e) {
      console.error('[chats] อ่านห้องแชทเก่าไม่ได้', e);
      return result;
    }
    for (const [key, raw] of entries) {
      const persona = Number(key.slice(KEY_PREFIX.length));
      if (!isPersona(persona) || raw == null) continue;
      const parsed = parseJSON(raw, isArray);
      if (!parsed) {
        console.error(`[chats] ${key}: ข้อมูลเสีย — ตัดทิ้ง`);
        continue;
      }
      result[persona] = parsed
        .map((c) => toArchive(c, persona))
        .filter((c): c is ChatArchive => c !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return result;
  },
};
