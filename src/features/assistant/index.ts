/**
 * @file ผู้ช่วยส่วนตัว — รวมความสามารถที่ลงทะเบียนเป็น agent (ผ่านระบบ pattern เดิม ไม่แตะ router)
 *
 * ลำดับสำคัญ: AgentClassifier ให้ตัวแรกที่ match ชนะ → ตัวแคบ/เฉพาะเจาะจงอยู่ก่อน ตัวกว้างอยู่หลัง
 * (เช่น place ก่อน web-search เพราะ "ค้นหาร้านกาแฟใกล้ฉัน" ต้องไปหาร้าน ไม่ใช่ค้นเว็บ)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { createCalendarAgent } from './agents/calendar';
import { createClockAgent } from './agents/clock';
import { createContactsAgent } from './agents/contacts';
import { assistantStore, createCustomAssistantsAgent } from './agents/customAssistants';
import { createHomeAgent } from './agents/homeAssistant';
import { createImageAgent } from './agents/image';
import { createPlaceAgent } from './agents/place';
import { createReminderAgent } from './agents/reminder';
import { createVisionAgent } from './agents/vision';
import { createWebSearchAgent } from './agents/webSearch';

/** ตัวสร้างเรียงตามลำดับลงทะเบียน (แคบ → กว้าง) */
export const ASSISTANT_AGENT_FACTORIES: readonly (() => AgentDefinition)[] = [
  createClockAgent,
  createContactsAgent,
  createReminderAgent,
  createCalendarAgent,
  createHomeAgent,
  createCustomAssistantsAgent,
  createPlaceAgent,
  createImageAgent,
  createVisionAgent,
  createWebSearchAgent,
];

/** ลงทะเบียนครบทุกตัว (เรียกซ้ำได้ — ตัวที่มีแล้วข้าม) · คืนจำนวนที่เพิ่ม */
export function registerAssistantAgents(registry: AgentRegistry = agentRegistry): number {
  let added = 0;
  for (const create of ASSISTANT_AGENT_FACTORIES) {
    const agent = create();
    if (!registry.has(agent.id)) {
      registry.register(agent);
      added++;
    }
  }
  return added;
}

/** โหลดข้อมูลที่ต้องอ่านจาก storage ตอนเปิดแอป (รายชื่อผู้ช่วยที่สร้างเอง) */
export function loadAssistantData(): Promise<void> {
  return assistantStore.load();
}
