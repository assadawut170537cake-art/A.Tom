/**
 * @file Agent "งานวันนี้" — สั่งเช็กลิสต์ในแท็บ "วันนี้" ด้วยแชท/เสียง (Boss ขอ 2026-10-20)
 *
 * | คำสั่ง                                  | ทำอะไร                |
 * |-----------------------------------------|-----------------------|
 * | "เพิ่มงาน ซื้อของ" / "เพิ่มงาน: ซื้อของ"   | เพิ่มเข้าเช็กลิสต์      |
 * | "ติ๊กงาน ซื้อของ" / "งาน ซื้อของ เสร็จแล้ว" | ทำเครื่องหมายว่าเสร็จ  |
 * | "งานวันนี้มีอะไร" / "เช็กลิสต์"             | อ่านงานที่ยังไม่เสร็จ    |
 *
 * pattern ขึ้นต้นประโยคเสมอ (มาก่อน LLM) · ไม่มีคำว่า "เครื่อง" (RuleClassifier จะแย่ง)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { findTask, useTodayStore } from '../../features/today/todayStore';

export const TODAY_AGENT_ID = 'today';
const POLITE = String.raw`\s*(?:ให้หน่อย|หน่อย|ด้วย|ครับ|ค่ะ|คะ|นะ)*\s*[.!?]?$`;

export function createTodayAgent(store = useTodayStore): AgentDefinition {
  return {
    id: TODAY_AGENT_ID,
    name: 'งานวันนี้',
    description: 'เช็กลิสต์งานที่ทำอยู่ในแท็บ "วันนี้"',
    capabilities: [
      {
        id: 'today.add',
        label: 'เพิ่มงาน',
        patterns: [
          new RegExp(
            String.raw`^(?:ช่วย\s*)?เพิ่ม(?:งาน|ลงเช็กลิสต์|เข้าเช็กลิสต์)\s*[:：]?\s*(?<command>\S.*?)${POLITE}`,
          ),
        ],
        examples: ['เพิ่มงาน ซื้อของเข้าบ้าน'],
      },
      {
        id: 'today.done',
        label: 'ติ๊กงานว่าเสร็จ',
        patterns: [
          new RegExp(String.raw`^(?:ติ๊ก|เช็ก)งาน\s*[:：]?\s*(?<command>\S.*?)${POLITE}`),
          new RegExp(String.raw`^งาน\s*(?<command>\S.*?)\s*เสร็จแล้ว${POLITE}`),
        ],
        examples: ['ติ๊กงาน ซื้อของ', 'งาน ซื้อของ เสร็จแล้ว'],
      },
      {
        id: 'today.list',
        label: 'อ่านงานวันนี้',
        patterns: [
          new RegExp(
            String.raw`^(?<command>งานวันนี้(?:มีอะไร(?:บ้าง)?)?|เช็กลิสต์(?:วันนี้)?)${POLITE}`,
          ),
        ],
        examples: ['งานวันนี้มีอะไรบ้าง'],
      },
    ],
    async run({ commandText, capabilityId }) {
      const state = store.getState();
      await state.load();
      if (capabilityId === 'today.add') {
        const task = store.getState().add(commandText);
        return {
          reply: task
            ? `เพิ่ม "${task.text}" ลงเช็กลิสต์วันนี้แล้วครับ`
            : 'ยังไม่ได้บอกว่างานอะไรครับ',
        };
      }
      const tasks = store.getState().tasks;
      if (capabilityId === 'today.done') {
        const task = findTask(tasks, commandText);
        if (!task) return { reply: `ไม่เจองาน "${commandText}" ในเช็กลิสต์ครับ` };
        if (!task.done) store.getState().toggle(task.id);
        return { reply: `ติ๊ก "${task.text}" ว่าเสร็จแล้วครับ` };
      }
      const pending = tasks.filter((t) => !t.done);
      if (!pending.length) return { reply: 'วันนี้ไม่มีงานค้างครับ' };
      return {
        reply: `งานที่ยังไม่เสร็จ ${pending.length} งานครับ: ${pending.map((t) => t.text).join(' · ')}`,
      };
    },
  };
}

/** ลงทะเบียน agent งานวันนี้ (เรียกซ้ำได้) */
export function registerTodayAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(TODAY_AGENT_ID)) registry.register(createTodayAgent());
}
