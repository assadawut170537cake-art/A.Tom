/**
 * @file ลิงก์ `atom://…` — เปิดแอปตรงไปที่งานนั้น (widget หน้าจอหลัก · กดค้างไอคอน · กดค้างปุ่มโฮม)
 *
 * | ลิงก์                      | ผล                                    |
 * |---------------------------|---------------------------------------|
 * | `atom://live`             | คุยด้วยเสียงทันที (ASSIST / VOICE_COMMAND ถูกแปลงเป็นลิงก์นี้ใน MainActivity) |
 * | `atom://chat?text=…`      | หน้าแชท + ใส่ข้อความรอในช่องพิมพ์ (ไม่ส่งเอง)      |
 * | `atom://new`              | แชทใหม่                                 |
 * | `atom://today` · `atom://memory` | เปิดแท็บนั้น                      |
 *
 * ลิงก์มาจากแอปอื่นได้ด้วย จึงไม่มีลิงก์ไหน "ส่งข้อความ" หรือสั่งงานเอง — แค่พาไปหน้าจอ / เปิดไมค์ที่บอสเห็น
 */

import { create } from 'zustand';

import type { TabKey } from '../types';

export type DeepLinkAction =
  | { type: 'live' }
  | { type: 'tab'; tab: TabKey }
  | { type: 'chat'; text: string }
  | { type: 'new-chat' };

const MAX_DRAFT = 2000;

export function parseDeepLink(url: string | null | undefined): DeepLinkAction | null {
  if (!url) return null;
  const m = /^atom:\/\/\/?([a-z-]+)\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!m) return null;
  const route = (m[1] ?? '').toLowerCase();
  switch (route) {
    case 'live':
    case 'voice':
      return { type: 'live' };
    case 'today':
    case 'memory':
      return { type: 'tab', tab: route };
    case 'new':
      return { type: 'new-chat' };
    case 'chat': {
      let text = '';
      try {
        text = new URLSearchParams(m[2] ?? '').get('text') ?? '';
      } catch {
        // query เสีย — เปิดหน้าแชทเฉย ๆ
      }
      return { type: 'chat', text: text.slice(0, MAX_DRAFT) };
    }
    default:
      return null;
  }
}

interface DeepLinkState {
  /** ลิงก์ขอเปิดโหมดเสียงค้างอยู่ — แท็บ Atom (เจ้าของไมค์) เห็นแล้วรับไปเริ่มเอง (แท็บอาจยังไม่ mount) */
  livePending: boolean;
  requestLive: () => void;
  /** รับคำขอ (คืน true ครั้งเดียวต่อคำขอ) */
  takeLive: () => boolean;
}

export const useDeepLinkStore = create<DeepLinkState>()((set, get) => ({
  livePending: false,
  requestLive: () => set({ livePending: true }),
  takeLive: () => {
    if (!get().livePending) return false;
    set({ livePending: false });
    return true;
  },
}));
