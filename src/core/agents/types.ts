/**
 * @file Agent — ผู้ช่วยเฉพาะทางที่รับคำสั่งจากแชทได้ตรง ๆ (เช่น "จดบันทึกว่า…") และมี UI ของตัวเองได้
 *
 * ต่างจาก module (`core/modules`) ตรงที่ agent ประกาศ **capability พร้อม pattern ของคำสั่ง**
 * ให้ AgentClassifier จับคู่ข้อความได้เองโดยไม่ต้องถาม LLM และมีหน้าจอ (`loadScreen`) แบบ lazy
 * ที่เปิดเป็น Agent Panel บนหน้าหลักหรือหน้า AgentScreen
 *
 * ไม่ใช่ `core/agent/` (AgentHarness = loop ให้ LLM เรียก tool) — คนละเรื่องกัน
 */

import type { ComponentType } from 'react';

import type { Persona } from '../types/persona';

/** สิ่งที่ agent ทำได้ 1 อย่าง + pattern ของประโยคที่สั่งมัน */
export interface AgentCapability {
  /** unique ภายใน agent เช่น 'note.add' */
  readonly id: string;
  /** คำอธิบายสั้น ๆ (แสดงใน UI / ส่งให้ LLM ในอนาคต) */
  readonly label: string;
  /**
   * จับคู่กับข้อความทั้งประโยค (trim แล้ว) — ตัวแรกที่ match ชนะ
   * ถ้ามี named group `command` → ใช้เป็น `commandText` ไม่งั้นใช้ข้อความที่เหลือหลังตัดส่วนที่ match ออก
   */
  readonly patterns: readonly RegExp[];
  /** ตัวอย่างคำสั่ง (ใช้ในเอกสาร / UI) */
  readonly examples?: readonly string[] | undefined;
}

export interface AgentRunInput {
  /** ข้อความเต็มของบอส */
  text: string;
  /** ส่วนที่เป็นเนื้อคำสั่ง เช่น "จดบันทึกว่า ซื้อนม" → "ซื้อนม" */
  commandText: string;
  /** capability ที่ match (ไม่มี = เรียกตรงโดยไม่ผ่าน classifier) */
  capabilityId?: string | undefined;
  persona: Persona;
}

export interface AgentRunResult {
  /** ข้อความตอบกลับ (แสดง + พูด) */
  reply: string;
  /** true = ขอเปิด UI ของ agent (มีผลเฉพาะ agent ที่มี `loadScreen`) */
  showScreen?: boolean | undefined;
  /** รูปที่แนบกับคำตอบ (file:// ในเครื่อง) — แสดงใต้ข้อความในแชท */
  imageUri?: string | undefined;
  /** การ์ดกราฟิกแสดงผล (Visual Card เช่น สภาพอากาศ นัดหมาย แจ้งเตือน) */
  visualCard?: any | undefined;
}

export interface AgentScreenProps {
  agentId: string;
  /** ปิด panel / ย้อนกลับ */
  onClose: () => void;
}

export type AgentScreenComponent = ComponentType<AgentScreenProps>;

export interface AgentDefinition {
  /** unique, stable เช่น 'note' */
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly capabilities: readonly AgentCapability[];
  /** ทำงานตามคำสั่ง — throw ได้ (AgentHandler แปลงเป็นข้อความไทยให้) */
  run(input: AgentRunInput): Promise<AgentRunResult>;
  /** โหลด UI แบบ lazy (`() => import('./Screen')`) — ไม่มี = agent ไม่มีหน้าจอ */
  loadScreen?: (() => Promise<AgentScreenComponent>) | undefined;
}

/** metadata ของ agent ที่ UI/classifier ใช้ (ไม่มีฟังก์ชัน) */
export interface AgentInfo {
  id: string;
  name: string;
  description?: string | undefined;
  capabilities: { id: string; label: string; examples: readonly string[] }[];
  hasScreen: boolean;
}
