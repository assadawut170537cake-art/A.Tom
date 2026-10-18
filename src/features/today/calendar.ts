/**
 * @file อ่าน/เพิ่มนัดในปฏิทินของเครื่อง (Google Calendar ที่ซิงก์ในมือถือก็อยู่ในนี้) ผ่าน expo-calendar
 *
 * ใช้ API `expo-calendar/legacy` — API หลักของ SDK 57 เปลี่ยนเป็นแบบ object (`next`) แต่ legacy ยังรองรับครบ
 * และเรียบง่ายกว่าสำหรับงานแค่ "ดูนัดวันนี้ / เพิ่มนัด"
 */

import * as Calendar from 'expo-calendar/legacy';

import { DAY_MS, startOfDay } from './thaiTime';

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
}

export interface CalendarService {
  /** ได้สิทธิ์แล้วหรือยัง (ไม่ถาม) */
  hasPermission(): Promise<boolean>;
  /** ถามสิทธิ์ (ถ้ายังไม่ได้) — คืนผล */
  requestPermission(): Promise<boolean>;
  /** นัดที่คาบเกี่ยวช่วงเวลา — throw (ข้อความไทย) เมื่อไม่ได้สิทธิ์ */
  listEvents(start: number, end: number): Promise<CalendarEvent[]>;
  /** throw (ข้อความไทย) เมื่อไม่ได้สิทธิ์ หรือไม่มีปฏิทินที่เขียนได้ */
  addEvent(event: { title: string; start: number; end: number }): Promise<string>;
}

const NO_PERMISSION = 'ยังไม่ได้อนุญาตให้เข้าถึงปฏิทิน — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › สิทธิ์';

const toMs = (value: string | Date): number => (value instanceof Date ? value.getTime() : new Date(value).getTime());

async function ensurePermission(): Promise<void> {
  const current = await Calendar.getCalendarPermissionsAsync();
  if (current.granted) return;
  const asked = await Calendar.requestCalendarPermissionsAsync();
  if (!asked.granted) throw new Error(NO_PERMISSION);
}

/** ปฏิทินหลักที่เขียนได้ — Android ไม่มี getDefaultCalendarAsync */
async function writableCalendarId(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  const chosen = writable.find((c) => c.isPrimary) ?? writable[0];
  if (!chosen) throw new Error('ไม่พบปฏิทินที่เพิ่มนัดได้ในเครื่อง — ลองเพิ่มบัญชี Google ในตั้งค่าเครื่องก่อน');
  return chosen.id;
}

export const deviceCalendar: CalendarService = {
  async hasPermission() {
    try {
      return (await Calendar.getCalendarPermissionsAsync()).granted;
    } catch {
      return false;
    }
  },

  async requestPermission() {
    try {
      return (await Calendar.requestCalendarPermissionsAsync()).granted;
    } catch (e) {
      console.error('[calendar] ขอสิทธิ์ปฏิทินไม่ได้', e);
      return false;
    }
  },

  async listEvents(start, end) {
    await ensurePermission();
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (!calendars.length) return [];
    const events = await Calendar.getEventsAsync(
      calendars.map((c) => c.id),
      new Date(start),
      new Date(end)
    );
    return events
      .map((e) => ({
        id: e.id,
        title: e.title || '(ไม่มีชื่อ)',
        start: toMs(e.startDate),
        end: toMs(e.endDate),
        allDay: e.allDay,
        location: e.location || null,
      }))
      .sort((a, b) => a.start - b.start);
  },

  async addEvent({ title, start, end }) {
    await ensurePermission();
    const calendarId = await writableCalendarId();
    return Calendar.createEventAsync(calendarId, {
      title,
      startDate: new Date(start),
      endDate: new Date(end),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  },
};

/** ช่วงเวลาของวัน (0 = วันนี้, 1 = พรุ่งนี้) */
export function dayRange(offset: number, now: number = Date.now()): { start: number; end: number } {
  const start = startOfDay(now).getTime() + offset * DAY_MS;
  return { start, end: start + DAY_MS };
}
