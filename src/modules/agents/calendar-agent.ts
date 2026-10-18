/**
 * @file Agent "ปฏิทิน" — ดูนัดวันนี้/พรุ่งนี้ และลงนัดใหม่ในปฏิทินของเครื่อง
 *
 * | คำสั่ง                                                | ผล             |
 * |-------------------------------------------------------|----------------|
 * | "วันนี้มีนัดอะไรบ้าง" · "ตารางพรุ่งนี้" · "ดูปฏิทิน"        | บอกรายการนัด    |
 * | "เพิ่มนัด หมอฟัน พรุ่งนี้ 10 โมง" · "ลงปฏิทินว่า …"        | สร้างนัด 1 ชั่วโมง |
 *
 * pattern ลงนัดต้องขึ้นต้นด้วย "เพิ่มนัด / ลงนัด / ลงปฏิทิน / นัดว่า" — "นัด" เฉย ๆ ใช้ในประโยคคุยทั่วไปบ่อย
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { dayRange, deviceCalendar, type CalendarEvent, type CalendarService } from '../../features/today/calendar';
import { formatClock, formatWhen, parseThaiWhen } from '../../features/today/thaiTime';

export const CALENDAR_AGENT_ID = 'calendar';
const EVENT_LENGTH_MS = 60 * 60 * 1000;

export const CALENDAR_HELP = 'บอกชื่อนัดกับเวลาให้หน่อยครับ เช่น "เพิ่มนัด หมอฟัน พรุ่งนี้ 10 โมง"';

export function describeEvent(e: CalendarEvent): string {
  const time = e.allDay ? 'ทั้งวัน' : formatClock(e.start);
  return `• ${time} ${e.title}${e.location ? ` (${e.location})` : ''}`;
}

export function createCalendarAgent(
  calendar: CalendarService = deviceCalendar,
  now: () => number = Date.now
): AgentDefinition {
  return {
    id: CALENDAR_AGENT_ID,
    name: 'ปฏิทิน',
    description: 'ดูนัดและลงนัดในปฏิทินของเครื่อง',
    capabilities: [
      {
        id: 'calendar.list',
        label: 'ดูนัด',
        patterns: [
          /^(?:ดู|เปิด|เช็[กค])?\s*(?:ปฏิทิน|ตารางงาน|ตารางนัด|ตาราง)\s*(?<command>วันนี้|พรุ่งนี้)?$/,
          /^(?<command>วันนี้|พรุ่งนี้)?\s*(?:มี|ติด)(?:นัด|ประชุม)(?:อะไร|กี่โมง|ที่ไหน)?(?:บ้าง)?(?:\s*(?:วันนี้|พรุ่งนี้))?(?:ไหม|มั้ย|หรือเปล่า)?$/,
          /^(?:what'?s\s+on\s+)?(?:my\s+)?(?:calendar|schedule)(?:\s+(?<command>today|tomorrow))?$/i,
        ],
        examples: ['วันนี้มีนัดอะไรบ้าง', 'ตารางพรุ่งนี้'],
      },
      {
        id: 'calendar.add',
        label: 'ลงนัด',
        patterns: [
          /^(?:ช่วย)?(?:เพิ่มนัด(?:หมาย)?|ลงนัด(?:หมาย)?|สร้างนัด(?:หมาย)?|ลง(?:ใน)?ปฏิทิน|เพิ่ม(?:ลง)?(?:ใน)?ปฏิทิน|ใส่ปฏิทิน)\s*(?:ว่า|:)?\s*(?<command>[\s\S]+)$/,
          /^นัด(?:หมาย)?\s*(?:ว่า|:)\s*(?<command>[\s\S]+)$/,
        ],
        examples: ['เพิ่มนัด หมอฟัน พรุ่งนี้ 10 โมง', 'ลงปฏิทินว่า ประชุมทีม วันจันทร์ บ่าย 2'],
      },
    ],

    async run({ text, commandText, capabilityId }) {
      const current = now();
      if (capabilityId === 'calendar.list') {
        const tomorrow = /พรุ่งนี้|tomorrow/i.test(commandText || text);
        const { start, end } = dayRange(tomorrow ? 1 : 0, current);
        const events = await calendar.listEvents(start, end);
        const day = tomorrow ? 'พรุ่งนี้' : 'วันนี้';
        if (!events.length) return { reply: `${day}ไม่มีนัดในปฏิทินครับ` };
        return { reply: `${day}มีนัด ${events.length} รายการครับ\n${events.map(describeEvent).join('\n')}` };
      }

      const when = parseThaiWhen(commandText, current);
      if (!when) return { reply: CALENDAR_HELP };
      const title = when.text || 'นัดหมาย';
      await calendar.addEvent({ title, start: when.at, end: when.at + EVENT_LENGTH_MS });
      return { reply: `ลงปฏิทินแล้วครับ: “${title}” — ${formatWhen(when.at, current)}` };
    },
  };
}

export function registerCalendarAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(CALENDAR_AGENT_ID)) registry.register(createCalendarAgent());
}
