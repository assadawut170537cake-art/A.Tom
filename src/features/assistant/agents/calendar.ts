/**
 * @file ปฏิทิน: ดูนัดวันนี้/พรุ่งนี้/สัปดาห์นี้ และสร้างนัดใหม่ — ใช้ปฏิทินของเครื่อง (รวม Google Calendar ที่ซิงก์อยู่แล้ว)
 * การดูนัดใช้ช่วงเวลาจากคำสั่งโดยตรง (ไม่เรียก LLM) · การสร้างนัดใช้ LLM แปลงประโยคไทยเป็นวันเวลา
 */

import type { AgentDefinition } from '../../../core/agents/types';
import { AssistantError, loadNative } from '../shared/errors';
import { appLlm, extractJson, str, type Llm } from '../shared/llm';
import { parseDate, speakDate, speakTime, toLocalISO } from '../shared/time';

export const CALENDAR_AGENT_ID = 'calendar';

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
}

export interface CalendarApi {
  /** false = ไม่ได้สิทธิ์ */
  ensurePermission(): Promise<boolean>;
  events(start: Date, end: Date): Promise<CalendarEvent[]>;
  create(event: { title: string; start: Date; end: Date; location?: string }): Promise<void>;
}

function defaultApi(): CalendarApi {
  const lib = () =>
    loadNative(
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
      () => require('expo-calendar/legacy') as typeof import('expo-calendar/legacy'),
      'ปฏิทิน',
    );
  const calendars = async () => {
    const Calendar = lib();
    return Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  };
  return {
    async ensurePermission() {
      return (await lib().requestCalendarPermissionsAsync()).granted;
    },
    async events(start, end) {
      const Calendar = lib();
      const ids = (await calendars()).map((c) => c.id);
      if (ids.length === 0) return [];
      const events = await Calendar.getEventsAsync(ids, start, end);
      return events.map((e) => ({
        title: e.title,
        start: new Date(e.startDate),
        end: new Date(e.endDate),
        ...(e.allDay ? { allDay: true } : {}),
        ...(e.location ? { location: e.location } : {}),
      }));
    },
    async create(event) {
      const Calendar = lib();
      const writable = (await calendars()).filter((c) => c.allowsModifications);
      const target = writable.find((c) => c.isPrimary) ?? writable[0];
      if (!target)
        throw new AssistantError(
          'ไม่พบปฏิทินที่เขียนได้ในเครื่อง — เพิ่มบัญชี Google ในตั้งค่าเครื่องก่อนครับ',
        );
      await Calendar.createEventAsync(target.id, {
        title: event.title,
        startDate: event.start,
        endDate: event.end,
        ...(event.location ? { location: event.location } : {}),
      });
    },
  };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** ช่วงวันที่ถามถึง จากคำในประโยค: วันนี้ (ค่าเริ่มต้น) · พรุ่งนี้ · มะรืนนี้ · สัปดาห์นี้ */
export function rangeFor(text: string, now: Date): { start: Date; end: Date; label: string } {
  const today = startOfDay(now);
  if (/สัปดาห์|อาทิตย์|7 วัน/.test(text))
    return { start: today, end: addDays(today, 7), label: 'ใน 7 วันนี้' };
  if (/มะรืน/.test(text))
    return { start: addDays(today, 2), end: addDays(today, 3), label: 'มะรืนนี้' };
  if (/พรุ่งนี้/.test(text))
    return { start: addDays(today, 1), end: addDays(today, 2), label: 'พรุ่งนี้' };
  return { start: today, end: addDays(today, 1), label: 'วันนี้' };
}

export function summarizeEvents(events: CalendarEvent[], label: string, withDay: boolean): string {
  if (events.length === 0) return `${label}ไม่มีนัดเลยครับ`;
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const lines = sorted.slice(0, 5).map((e) => {
    const when = e.allDay ? 'ทั้งวัน' : withDay ? speakDate(e.start) : speakTime(e.start);
    return `${when} ${e.title}`;
  });
  const more = sorted.length > 5 ? ` และอีก ${sorted.length - 5} รายการ` : '';
  return `${label}มี ${sorted.length} นัดครับ: ${lines.join(' · ')}${more}`;
}

export interface CalendarDeps {
  api?: CalendarApi;
  llm?: Llm;
  now?: () => Date;
}

export function createCalendarAgent(deps: CalendarDeps = {}): AgentDefinition {
  const api = deps.api ?? defaultApi();
  const llm = deps.llm ?? appLlm;
  const clock = deps.now ?? (() => new Date());
  const DENIED = 'ยังไม่ได้อนุญาตให้เข้าถึงปฏิทิน — เปิดสิทธิ์ในตั้งค่าเครื่องก่อนครับ';

  return {
    id: CALENDAR_AGENT_ID,
    name: 'ปฏิทิน',
    description: 'ดูนัดหมายและสร้างนัดใหม่ในปฏิทินของเครื่อง',
    capabilities: [
      {
        id: 'calendar.agenda',
        label: 'ดูนัดหมาย',
        patterns: [
          /^(?:ดู|เช็ก|เช็ค|เปิด)?\s*(?:ตารางนัด|ตารางงาน|นัดหมาย|ปฏิทิน|agenda)\s*(?<command>.*)$/i,
          /^(?<command>(?:วันนี้|พรุ่งนี้|มะรืนนี้|สัปดาห์นี้|อาทิตย์นี้).{0,10}(?:มีนัด|มีงาน|มีประชุม|ว่างไหม|มีอะไรบ้าง).*)$/,
        ],
        examples: ['ดูตารางนัดพรุ่งนี้', 'วันนี้มีนัดอะไรบ้าง'],
      },
      {
        id: 'calendar.create',
        label: 'สร้างนัดหมาย',
        patterns: [
          /^(?:ช่วย)?(?:เพิ่มนัด|สร้างนัด|ลงปฏิทิน|จดนัด|นัดหมายใหม่)\s*(?<command>.{3,})$/,
          // "นัดหมอพรุ่งนี้ 10 โมง": คำว่า นัด เฉย ๆ กว้างเกิน → ต้องมีวัน/เวลาในประโยค และไม่ใช่คำถาม
          /^(?:ช่วย)?นัด(?:หมาย)?\s*(?<command>(?=.*(?:พรุ่งนี้|วันนี้|มะรืน|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|\d|โมง|ทุ่ม|เที่ยง|ตี\s*\d|บ่าย|เช้า|เย็น))(?!.*(?:ไหม|หรือเปล่า|อะไร|เมื่อไหร่|ยังไง)$).{3,})$/,
        ],
        examples: ['นัดหมอพรุ่งนี้ 10 โมง', 'ลงปฏิทิน ประชุมทีมวันศุกร์บ่าย 2'],
      },
    ],
    async run({ text, commandText, capabilityId }) {
      if (!(await api.ensurePermission())) return { reply: DENIED };
      const now = clock();

      if (capabilityId === 'calendar.create') {
        const parsed = await extractJson(
          llm,
          'แปลงประโยคเป็นนัดหมายในปฏิทิน (เวลาท้องถิ่นของผู้ใช้) ถ้าไม่ระบุเวลาสิ้นสุดให้ end = start + 1 ชั่วโมง',
          '{"title":"ชื่อนัดสั้นๆ","start":"ISO 8601 พร้อม offset","end":"ISO 8601 หรือ null","location":"สถานที่หรือ null"}',
          commandText,
          (v) => {
            const title = str(v.title);
            const start = parseDate(v.start);
            if (!title || !start) return null;
            const end = parseDate(v.end);
            const location = str(v.location);
            return {
              title,
              start,
              end: end && end > start ? end : new Date(start.getTime() + 3_600_000),
              location,
            };
          },
          now,
        );
        if (parsed.start.getTime() < now.getTime() - 60_000) {
          return { reply: `เวลา ${speakDate(parsed.start)} ผ่านไปแล้วครับ — ลองบอกวันเวลาใหม่` };
        }
        await api.create({
          title: parsed.title,
          start: parsed.start,
          end: parsed.end,
          ...(parsed.location ? { location: parsed.location } : {}),
        });
        return { reply: `ลงปฏิทินแล้วครับ: ${parsed.title} ${speakDate(parsed.start)}` };
      }

      const range = rangeFor(`${text} ${commandText}`, now);
      const events = await api.events(range.start, range.end);
      const multiDay = range.end.getTime() - range.start.getTime() > 86_400_000;
      return { reply: summarizeEvents(events, range.label, multiDay) };
    },
  };
}

export { toLocalISO };
