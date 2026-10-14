export type Persona = 1 | 2 | 3 | 4;
export type OrbMood = 'idle' | 'listening' | 'thinking' | 'speaking';
export type UIMode = 'idle' | 'conversation';
export type TabKey = 'atom' | 'today' | 'memory';
export type MessageRole = 'user' | 'assistant' | 'system';

/** State names understood by the Orb HTML bridge (window.setOrbState). */
export type OrbBridgeState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export interface Message {
  id: string;
  persona: Persona;
  role: MessageRole;
  content: string;
  /** epoch ms */
  createdAt: number;
}

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
