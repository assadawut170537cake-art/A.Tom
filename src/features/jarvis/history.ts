/**
 * @file แบ่งประวัติแชทเป็น "บทสนทนา" (หัวข้อ) แบบรายการแชทของ Claude — Boss ขอ 2026-10-21
 *
 * แอปเก็บแชทเป็นสายเดียวต่อ persona (lock ข้อ 6) จึงไม่มี session จริง → แบ่งเองจากช่วงเงียบ:
 * ห่างจากข้อความก่อนหน้าเกิน {@link CONVERSATION_GAP_MS} = เริ่มบทสนทนาใหม่ · ชื่อ = ข้อความแรกของบอส
 * ตรรกะล้วน (ไม่แตะ storage) — เปลี่ยนวิธีแบ่งได้ที่ไฟล์นี้ที่เดียว
 */

import type { Persona } from '../../core/types/persona';
import type { Message } from './types';

/** เงียบนานเท่านี้ = คุยเรื่องใหม่ */
export const CONVERSATION_GAP_MS = 30 * 60 * 1000;
const TITLE_MAX = 48;

export interface Conversation {
  /** id ของข้อความแรก (คงที่ ใช้เป็น key ได้) */
  id: string;
  persona: Persona;
  title: string;
  /** ข้อความล่าสุดในบทสนทนา (ตัวอย่างใต้ชื่อ) */
  preview: string;
  startedAt: number;
  lastAt: number;
  messages: Message[];
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** ข้อความของ persona หนึ่ง (เรียงเวลาแล้ว) → บทสนทนา · ข้อความระบบ (⚠️) ไม่นับเป็นเนื้อหา แต่ยังอยู่ในบทสนทนา */
export function groupConversations(
  messages: readonly Message[],
  gapMs = CONVERSATION_GAP_MS,
): Conversation[] {
  const groups: Message[][] = [];
  let last = -Infinity;
  for (const m of messages) {
    const current = groups[groups.length - 1];
    if (!current || m.createdAt - last > gapMs) groups.push([m]);
    else current.push(m);
    last = m.createdAt;
  }
  return groups
    .map((msgs): Conversation | null => {
      const talk = msgs.filter((m) => m.role !== 'system');
      const first = talk[0];
      const latest = talk[talk.length - 1];
      if (!first || !latest) return null; // มีแต่ข้อความระบบ = ไม่แสดงเป็นหัวข้อ
      const opener = talk.find((m) => m.role === 'user') ?? first;
      return {
        id: first.id,
        persona: first.persona,
        title: oneLine(opener.content, TITLE_MAX) || 'บทสนทนา',
        preview: oneLine(latest.content, 80),
        startedAt: first.createdAt,
        lastAt: latest.createdAt,
        messages: msgs,
      };
    })
    .filter((c): c is Conversation => c !== null);
}

/** หัวข้อกลุ่มตามวัน: วันนี้ / เมื่อวาน / 7 วันก่อน / วันที่ */
export function dayLabel(at: number, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(at))) / 86_400_000);
  if (diff <= 0) return 'วันนี้';
  if (diff === 1) return 'เมื่อวาน';
  if (diff < 7) return '7 วันที่ผ่านมา';
  const d = new Date(at);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
}
