import { Platform } from 'react-native';

import type { Persona } from '../../../core/types/persona';
import type { OrbBridgeState, OrbMood, PersonaMeta, TabMeta } from '../types';

// ย้ายไป core/types/persona แล้ว — re-export ไว้ให้ import จากที่เดิมได้
export { DEFAULT_PERSONA, PERSONA_IDS } from '../../../core/types/persona';

export const PERSONAS: Record<Persona, PersonaMeta> = {
  1: { id: 1, name: 'อะตอม', nameEn: 'ATOM', color: '#f5a623', desc: 'นักเลง 2499' },
  2: { id: 2, name: 'จาร์วิส', nameEn: 'JARVIS', color: '#3b82f6', desc: 'พระเอกสุขุม' },
  3: { id: 3, name: 'ไฟรเดย์', nameEn: 'FRIDAY', color: '#00d4ff', desc: 'เนี๊ยบ ไร้ที่ติ' },
  4: { id: 4, name: 'อัลตรอน', nameEn: 'ULTRON', color: '#ff0033', desc: 'ดุดัน พร้อมบวก' },
};

export const TABS: TabMeta[] = [
  { key: 'atom', label: 'Atom' },
  { key: 'today', label: 'Today' },
  { key: 'memory', label: 'Memory' },
];

export const LAYOUT = {
  orb: {
    nativeSize: 180,
    idleScale: 1,
    conversationScale: 0.2667,
    /** Orb centre as a fraction of the safe-area height while idle */
    idleCenterY: 0.42,
    conversationTop: 72,
  },
  dropdown: { top: 72, width: 260 },
  chat: { topPadding: 140, bottomPadding: 180 },
  actionBar: { bottom: 96 },
  header: { height: 56 },
} as const;

export const ANIMATION = {
  orbSpring: { damping: 18, stiffness: 160, mass: 1 },
  chatFadeMs: 250,
  chatOffsetY: 20,
} as const;

export const MOOD_TO_ORB_STATE: Record<OrbMood, OrbBridgeState> = {
  idle: 'IDLE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
};

export const USER_NAME = 'บอส';

/** Placeholder greetings until API integration lands (Phase 3). */
export const PERSONA_GREETINGS: Record<Persona, string> = {
  1: 'ว่าไงลูกพี่บอส ดึกป่านนี้ยังไม่นอนอีกเรอะ มีอะไรให้อะตอมจัดการก็ว่ามา',
  2: 'สวัสดีครับบอส จาร์วิสพร้อมรับคำสั่งแล้วครับ',
  3: 'สวัสดีค่ะบอส ไฟรเดย์เตรียมทุกอย่างไว้เรียบร้อยแล้วค่ะ',
  4: 'บอส ว่ามาเลย อัลตรอนพร้อมลุยทุกเรื่อง',
};

export const FONTS = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
} as const;
