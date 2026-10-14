/**
 * @file ข้อความแชทหนึ่งข้อความ — รูปแบบที่เก็บใน ChatHistoryStorage และแสดงใน UI
 */

import type { Persona } from './persona';

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Message {
  id: string;
  persona: Persona;
  role: MessageRole;
  content: string;
  /** epoch ms */
  createdAt: number;
}
