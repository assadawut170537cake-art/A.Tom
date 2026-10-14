import type { Persona } from '../../../core/types/persona';

// ย้ายไป core/types แล้ว — re-export ไว้ให้ไฟล์ใน jarvis import จากที่เดิมได้
export type { Persona } from '../../../core/types/persona';
export type { Message, MessageRole } from '../../../core/types/message';

export type OrbMood = 'idle' | 'listening' | 'thinking' | 'speaking';
export type UIMode = 'idle' | 'conversation';
export type TabKey = 'atom' | 'today' | 'memory';

/** State names understood by the Orb HTML bridge (window.setOrbState). */
export type OrbBridgeState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export interface PersonaMeta {
  id: Persona;
  name: string;
  nameEn: string;
  color: string;
  desc: string;
}

export interface TabMeta {
  key: TabKey;
  label: string;
}
