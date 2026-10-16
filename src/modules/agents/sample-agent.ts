/**
 * @file Sample agent "โน้ต" — ตัวอย่าง agent ที่มีทั้งคำสั่งในแชทและ UI ของตัวเอง (Agent Panel)
 *
 * | คำสั่ง                                  | ผล                              |
 * |-----------------------------------------|---------------------------------|
 * | "จดบันทึกว่า …" / "จดไว้ว่า …" / "note: …" | เก็บโน้ต + เปิด panel รายการโน้ต |
 * | "ดูโน้ต" / "เปิดบันทึก" / "show notes"     | เปิด panel รายการโน้ต            |
 *
 * pattern ตั้งใจให้แคบ (ต้องขึ้นต้นประโยค + มี "ว่า" หรือ ":") เพราะ AgentClassifier มาก่อน Jev/LLM —
 * ถ้ากว้างไป ประโยคคุยปกติอย่าง "บันทึกนี้ดีไหม" จะโดน agent แย่งไป
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { noteStore, type NoteStore } from './noteStore';

export const NOTE_AGENT_ID = 'note';

export function createNoteAgent(store: NoteStore = noteStore): AgentDefinition {
  return {
    id: NOTE_AGENT_ID,
    name: 'โน้ต',
    description: 'จดบันทึกสั้น ๆ จากแชท แล้วเปิดดูได้ใน panel',
    capabilities: [
      {
        id: 'note.add',
        label: 'จดบันทึก',
        patterns: [
          /^(?:ช่วย)?(?:จดบันทึก|จดโน้ต|จด|บันทึก)(?:ไว้)?\s*(?:ว่า|:)\s*(?<command>[\s\S]*)$/,
          /^(?:take\s+a\s+)?note\s*:\s*(?<command>[\s\S]*)$/i,
        ],
        examples: ['จดบันทึกว่า พรุ่งนี้ประชุม 9 โมง', 'note: ซื้อนม'],
      },
      {
        id: 'note.list',
        label: 'ดูโน้ตทั้งหมด',
        patterns: [/^(?:เปิด|ดู|แสดง)\s*(?:บันทึก|โน้ต)(?:ทั้งหมด)?$/, /^(?:show|open)\s+(?:my\s+)?notes$/i],
        examples: ['ดูโน้ต', 'เปิดบันทึก'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'note.list') {
        const count = (await store.list()).length;
        return { reply: count ? `มีโน้ตอยู่ ${count} รายการครับ` : 'ยังไม่มีโน้ตเลยครับ', showScreen: true };
      }
      const note = await store.add(commandText);
      return { reply: `จดแล้วครับบอส: “${note.text}”`, showScreen: true };
    },
    // Metro ต้องการ import() แบบ string คงที่ → ใส่ path ตรง ๆ
    loadScreen: () => import('./NoteAgentScreen').then((m) => m.NoteAgentScreen),
  };
}

/** ลงทะเบียน sample agent (เรียกซ้ำได้ — fast refresh / bootApp ซ้ำ) */
export function registerSampleAgents(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(NOTE_AGENT_ID)) registry.register(createNoteAgent());
}
