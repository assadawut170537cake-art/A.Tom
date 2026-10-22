/**
 * @file Agent "งาน" — ส่งคำสั่งหลายขั้นให้ AgentHarness (LLM เลือก tool ต่อกันเอง) จากแชท/เสียง
 *
 * | คำสั่ง                                                       | ทำอะไร                                  |
 * |--------------------------------------------------------------|-----------------------------------------|
 * | "จัดการว่า เปิด LINE ส่งข้อความหาแม่ว่าถึงบ้านแล้ว" / "ฝากงาน: …" | ทั้งประโยคหลัง "ว่า"/":" → AgentHarness |
 * | "เปิดแอป LINE แล้วพิมพ์ว่า สวัสดี" (หลัง "แล้ว" ไม่ใช่ กด/แตะ/คลิก) | ทั้งประโยค → AgentHarness               |
 *
 * ทำไมเป็น agent (intent `agent`) ไม่ใช่ intent ใหม่: router lock ไว้ 4 intent · pattern แคบเหมือน agent อื่น
 * (ต้องมีคำขึ้นต้น + "ว่า"/":" หรือ "เปิดแอป … แล้ว…") จึงไม่แย่งประโยคคุยปกติ — คุยทั่วไปยังไป ChatHandler
 * "เปิดแอป X" เฉย ๆ / "เปิดแอป X แล้วกด Y" ยังเป็นของ agent อุปกรณ์ (regex ล้วน ไม่เสีย quota LLM)
 * → ต้องลงทะเบียน**ก่อน** agent อุปกรณ์ (ตัวแรกที่ match ชนะ)
 *
 * ปุ่มเสี่ยง: harness หยุดเมื่อ tool ขอยืนยัน → จำไว้ใน {@link ConfirmationStore} ตัวเดียวกับ agent อุปกรณ์
 * บอสพิมพ์/พูด "ยืนยัน" → agent อุปกรณ์รันคำสั่งนั้นด้วย `confirmed: true` (LLM ยืนยันเองไม่ได้ — harness ตัดทิ้ง)
 */

import type { AgentHarness } from '../../core/agent/AgentHarness';
import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { createAppAgent } from '../../features/ai/agent';
import { getPersonaPrompt } from '../../features/ai/prompts/personaPrompts';
import {
  createConfirmationStore,
  deviceConfirmations,
  type ConfirmationStore,
} from './confirmations';

export const TASK_AGENT_ID = 'task';
/** เปิดแอป → กด → พิมพ์ → กดส่ง → ตอบ = 5 ขั้นพอดี เผื่อ LLM อ่านจอ/ลองใหม่อีกนิด */
export const TASK_MAX_STEPS = 8;

/** แนบท้าย persona prompt — บอกวิธีทำงานกับมือถือที่ harness ไม่รู้ */
export const TASK_GUIDE = [
  'บอสสั่งงานบนมือถือ — แตกเป็นขั้นแล้วเรียก tool ทีละขั้น:',
  '- เปิดแอปด้วย device.launch ก่อนเสมอ (กด/พิมพ์/อ่านจอ ทำกับแอปที่อยู่หน้าสุด)',
  '- ไม่แน่ใจว่าบนจอมีอะไร → device.read_screen ก่อนกด',
  '- พิมพ์ต้องแตะช่องพิมพ์ให้โฟกัสก่อน (device.tap) แล้วค่อย device.type',
  '- tool ล้มเพราะยังไม่เปิดสิทธิ์/ยังไม่รองรับ → หยุด แล้วบอกบอสตามข้อความนั้น',
  '- ตอบบอสเป็นภาษาไทยสั้น ๆ ว่าทำอะไรไปแล้วบ้าง',
].join('\n');

type Harness = Pick<AgentHarness, 'run' | 'dispatch'>;

export interface TaskAgentDeps {
  /** สร้าง harness ใหม่ทุกครั้ง — รายการ tool (skill/MCP/อุปกรณ์) ล่าสุดเสมอ */
  createAgent?: (() => Promise<Harness>) | undefined;
  confirmations?: ConfirmationStore | undefined;
  personaPrompt?: typeof getPersonaPrompt | undefined;
}

export function createTaskAgent(deps: TaskAgentDeps = {}): AgentDefinition {
  const createAgent = deps.createAgent ?? (() => createAppAgent({ maxSteps: TASK_MAX_STEPS }));
  const confirmations = deps.confirmations ?? createConfirmationStore();
  const personaPrompt = deps.personaPrompt ?? getPersonaPrompt;

  return {
    id: TASK_AGENT_ID,
    name: 'ผู้ช่วยงาน',
    description: 'งานหลายขั้นบนมือถือ — AI เลือกเปิดแอป กด พิมพ์ อ่านจอ ต่อกันเอง',
    capabilities: [
      {
        id: 'task.run',
        label: 'สั่งงานหลายขั้น',
        patterns: [
          /^(?:ช่วย)?(?:จัดการ|ฝากงาน|สั่งงาน)(?:ให้)?(?:หน่อย)?\s*(?:ว่า|:)\s*(?<command>\S[\s\S]*)$/,
          /^task\s*:\s*(?<command>\S[\s\S]*)$/i,
        ],
        examples: [
          'จัดการว่า เปิด LINE แล้วส่งข้อความหาแม่ว่าถึงบ้านแล้ว',
          'ฝากงาน: อ่านแจ้งเตือนล่าสุด',
        ],
      },
      {
        id: 'task.chain',
        label: 'เปิดแอปแล้วทำต่อ',
        patterns: [
          // หลัง "แล้ว" ไม่ใช่ กด/แตะ/คลิก (แบบนั้น agent อุปกรณ์ทำเองได้ ไม่ต้องใช้ LLM)
          /^(?<command>(?:ช่วย)?เปิดแอป(?:พลิเคชัน|พลิเคชั่น)?\s*\S[\s\S]*?\s*แล้ว(?:ก็)?\s*(?!กด|แตะ|คลิก)\S[\s\S]*)$/,
        ],
        examples: ['เปิดแอป LINE แล้วพิมพ์ว่า สวัสดี'],
      },
    ],
    async run({ commandText, persona }) {
      const harness = await createAgent();
      const result = await harness.run({
        text: commandText,
        intent: 'agent',
        persona,
        systemPrompt: `${personaPrompt(persona)}\n\n${TASK_GUIDE}`,
      });
      if (result.stopReason === 'needs_confirmation' && result.pending) {
        confirmations.hold(result.pending, (call) => harness.dispatch(call));
      }
      return { reply: result.reply };
    },
  };
}

/** ลงทะเบียน agent งาน (เรียกซ้ำได้) — ต้องก่อน {@link registerDeviceAgent} */
export function registerTaskAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(TASK_AGENT_ID))
    registry.register(createTaskAgent({ confirmations: deviceConfirmations }));
}
