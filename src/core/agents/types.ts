// src/core/agents/types.ts

import React from 'react';

export type AgentId = string;

export interface AgentCapability {
  readonly intent: string;        // เช่น 'create_note', 'send_email', 'control_pc'
  readonly description: string;   // คำอธิบายเพื่อให้ Router เลือกใช้
  readonly example?: string;      // ตัวอย่างประโยคคำสั่งเพื่อให้ระบบ Rule-match เข้าใจง่าย
}

export interface AgentResult {
  readonly reply: string;         // ข้อความตอบกลับผู้ใช้ (แสดง/พูดเสียง)
  readonly data?: unknown;        // ข้อมูลดิบที่ส่งต่อให้ระบบอื่นใช้งาน
  readonly shouldNavigate?: boolean; // บอกว่าเอเจนนี้อยากให้เปิดหน้าจอ UI ของตัวเองไหม
}

export interface AgentScreenProps {
  agentId: AgentId;
  onResult?: (result: AgentResult) => void;
}

export interface AtomAgent {
  readonly id: AgentId;
  readonly name: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly capabilities: readonly AgentCapability[];

  /** ทำงานเบื้องหลัง (Background Logic Execution) */
  handle(input: string): Promise<AgentResult>;

  /** โหลดหน้าจอ UI แบบ Lazy dynamic import เพื่อประหยัด RAM */
  getScreenComponent?(): Promise<React.ComponentType<AgentScreenProps>>;
}

/** Logger เบื้องต้นของระบบเอเจน (โปรเจกต์นี้นิยม console.error เท่านั้น) */
export interface AgentLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

/** Default logger เบาๆ สำหรับเอเจนที่ไม่เตรียม logger เอง */
export const consoleAgentLogger: AgentLogger = {
  info: () => {},
  error: (msg, error) => console.error(msg, error),
};
