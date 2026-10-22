/**
 * @file Calendar Tool: อ่านและสร้างนัดหมายในปฏิทินระบบผ่าน expo-calendar
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

export interface CalendarEventItem {
  id?: string | undefined;
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string | undefined;
  notes?: string | undefined;
}

async function getDefaultCalendarSource(): Promise<Calendar.Source> {
  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  return defaultCalendar.source;
}

export async function getTargetCalendarId(): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('ไม่ได้รับสิทธิ์เข้าถึงปฏิทิน');
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const primary = calendars.find((c) => c.isPrimary) || calendars.find((c) => c.allowsModifications) || calendars[0];
  if (primary) return primary.id;

  const source =
    Platform.OS === 'ios'
      ? await getDefaultCalendarSource()
      : { isLocalAccount: true, name: 'A.T.O.M. Calendar', type: Calendar.SourceType.LOCAL };

  return await Calendar.createCalendarAsync({
    title: 'A.T.O.M. Agenda',
    color: '#38bdf8',
    entityType: Calendar.EntityTypes.EVENT,
    source,
    name: 'atom_agenda',
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

export async function listEventsForPeriod(startDate: Date, endDate: Date): Promise<CalendarEventItem[]> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('ไม่ได้รับสิทธิ์เข้าถึงปฏิทิน');
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const calendarIds = calendars.map((c) => c.id);
  if (!calendarIds.length) return [];

  const rawEvents = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
  return rawEvents.map((e) => ({
    id: e.id,
    title: e.title,
    startDate: new Date(e.startDate),
    endDate: new Date(e.endDate),
    ...(e.location ? { location: e.location } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
  }));
}

export async function createEvent(event: {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string | undefined;
  notes?: string | undefined;
}): Promise<string> {
  const calendarId = await getTargetCalendarId();
  return await Calendar.createEventAsync(calendarId, {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    ...(event.location ? { location: event.location } : {}),
    ...(event.notes ? { notes: event.notes } : {}),
    timeZone: 'Asia/Bangkok',
  });
}
