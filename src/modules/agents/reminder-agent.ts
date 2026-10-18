/**
 * @file Agent "เตือนความจำ" — ตั้งเตือนจากแชท/เสียง แล้วเด้งแจ้งเตือนของเครื่องตามเวลา
 *
 * | คำสั่ง                                        | ผล                     |
 * |-----------------------------------------------|------------------------|
 * | "เตือนอีก 10 นาที ให้กินยา" · "ตั้งเตือนพรุ่งนี้ 9 โมง ประชุม" · "remind me …" | ตั้งเตือน |
 * | "มีเตือนอะไรบ้าง" · "ดูการเตือน"                  | บอกรายการที่ยังไม่ถึงเวลา |
 *
 * อ่านเวลาด้วย parseThaiWhen ก่อน (เร็ว ไม่เปลือง token) ไม่ออกค่อยถาม AI · pattern ต้องขึ้นต้นด้วย "เตือน"
 * เพราะ AgentClassifier มาก่อน LLM — "ช่วยเตือนสติหน่อย" ก็จะโดนจับ แต่ไม่มีเวลา → ตอบให้บอกเวลา (ไม่เสียหาย)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { extractWhenWithAI } from '../../features/today/aiWhen';
import { reminderStore as defaultStore } from '../../features/today/notifications';
import type { ReminderStore } from '../../features/today/reminderStore';
import { formatWhen, parseThaiWhen, type ParsedWhen } from '../../features/today/thaiTime';

export const REMINDER_AGENT_ID = 'reminder';

export const REMINDER_HELP =
  'บอกเวลาให้หน่อยครับ เช่น "เตือนอีก 10 นาที ให้กินยา" หรือ "เตือนพรุ่งนี้ 9 โมง ประชุม"';

export interface ReminderAgentDeps {
  store?: ReminderStore;
  /** ทางสำรองเมื่ออ่านเวลาเองไม่ออก (ค่าเริ่มต้น = ถาม AI) · null = ไม่ถาม */
  extract?: ((text: string, now: number) => Promise<ParsedWhen | null>) | null;
  now?: () => number;
}

export function createReminderAgent(deps: ReminderAgentDeps = {}): AgentDefinition {
  const store = deps.store ?? defaultStore;
  const extract = deps.extract === undefined ? (t: string, n: number) => extractWhenWithAI(t, n) : deps.extract;
  const now = deps.now ?? Date.now;

  return {
    id: REMINDER_AGENT_ID,
    name: 'เตือนความจำ',
    description: 'ตั้งเตือนตามเวลา — เด้งแจ้งเตือนแม้ปิดแอป',
    capabilities: [
      {
        // มาก่อน reminder.add — "เตือนอะไรบ้าง" จะได้ไม่ถูกตั้งเป็นการเตือนชื่อ "อะไรบ้าง"
        id: 'reminder.list',
        label: 'ดูการเตือน',
        patterns: [
          /^(?:ดู|เปิด|แสดง|เช็[กค])\s*(?:การ|รายการ)?(?:แจ้ง)?เตือน(?:ความจำ)?(?:ทั้งหมด)?$/,
          /^(?:มี)?(?:การ)?(?:แจ้ง)?เตือน(?:อะไร)(?:บ้าง|ไว้บ้าง)?(?:ไหม|มั้ย)?$/,
          /^(?:show|list)\s+(?:my\s+)?reminders$/i,
        ],
        examples: ['มีเตือนอะไรบ้าง', 'ดูการเตือน'],
      },
      {
        id: 'reminder.add',
        label: 'ตั้งเตือน',
        patterns: [
          /^(?:ช่วย)?(?:ตั้ง(?:การ)?(?:แจ้ง)?เตือน|เตือน)(?:ความจำ)?(?:ฉัน|ผม|หนู|เรา|บอส|ด้วย|หน่อย)?\s*(?:ว่า|:)?\s*(?<command>[\s\S]+)$/,
          /^remind\s+me\s+(?:to\s+)?(?<command>[\s\S]+)$/i,
        ],
        examples: ['เตือนอีก 10 นาที ให้กินยา', 'ตั้งเตือนพรุ่งนี้ 9 โมง ประชุม'],
      },
    ],

    async run({ commandText, capabilityId }) {
      const current = now();
      if (capabilityId === 'reminder.list') {
        const upcoming = await store.upcoming();
        if (!upcoming.length) return { reply: 'ยังไม่มีการเตือนที่รออยู่ครับ' };
        const lines = upcoming.slice(0, 8).map((r) => `• ${formatWhen(r.at, current)} — ${r.text}`);
        const more = upcoming.length > 8 ? `\n…และอีก ${upcoming.length - 8} รายการ (ดูได้ที่แท็บ Today)` : '';
        return { reply: `การเตือนที่รออยู่ ${upcoming.length} รายการครับ\n${lines.join('\n')}${more}` };
      }

      const text = commandText.trim();
      if (!text) return { reply: REMINDER_HELP };
      const when = parseThaiWhen(text, current) ?? (extract ? await extract(text, current) : null);
      if (!when) return { reply: REMINDER_HELP };
      const reminder = await store.add(when.text, when.at);
      return { reply: `ตั้งเตือนแล้วครับ: “${reminder.text}” — ${formatWhen(reminder.at, current)}` };
    },
  };
}

export function registerReminderAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(REMINDER_AGENT_ID)) registry.register(createReminderAgent());
}
