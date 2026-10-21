/**
 * @file แจ้งเตือนในเครื่อง (expo-notifications): เตือนตามเวลา · สรุปเช้ารายวัน · แตะแจ้งเตือนแล้วให้ผู้ช่วยทำต่อ
 * lazy ทั้งโมดูล — ไม่มี native module = ทุกฟังก์ชันบอกวิธีแก้เป็นภาษาไทย (ไม่ทำแอปล้ม)
 */

import { loadNative } from './shared/errors';

export const REMINDER_CHANNEL = 'atom-reminders';

export interface ScheduledItem {
  id: string;
  title: string;
  body: string;
  /** วันเวลาที่จะเตือน (ครั้งเดียว) — undefined = รายวัน */
  at?: Date;
  daily?: { hour: number; minute: number };
  kind?: string;
}

export interface NotificationsApi {
  ensurePermission(): Promise<boolean>;
  scheduleAt(date: Date, title: string, body: string, kind: string): Promise<string>;
  scheduleDaily(
    hour: number,
    minute: number,
    title: string,
    body: string,
    kind: string,
  ): Promise<string>;
  cancel(id: string): Promise<void>;
  list(): Promise<ScheduledItem[]>;
}

function lib() {
  return loadNative(
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    () => require('expo-notifications') as typeof import('expo-notifications'),
    'แจ้งเตือน',
  );
}

export function defaultNotificationsApi(): NotificationsApi {
  return {
    async ensurePermission() {
      const N = lib();
      await N.setNotificationChannelAsync?.(REMINDER_CHANNEL, {
        name: 'เตือนจากผู้ช่วย',
        importance: N.AndroidImportance.HIGH,
      });
      const current = await N.getPermissionsAsync();
      if (current.granted) return true;
      return (await N.requestPermissionsAsync()).granted;
    },
    scheduleAt: (date, title, body, kind) =>
      lib().scheduleNotificationAsync({
        content: { title, body, data: { kind } },
        trigger: { type: 'date', date, channelId: REMINDER_CHANNEL } as never,
      }),
    scheduleDaily: (hour, minute, title, body, kind) =>
      lib().scheduleNotificationAsync({
        content: { title, body, data: { kind } },
        trigger: { type: 'daily', hour, minute, channelId: REMINDER_CHANNEL } as never,
      }),
    cancel: (id) => lib().cancelScheduledNotificationAsync(id),
    async list() {
      const items = await lib().getAllScheduledNotificationsAsync();
      return items.map((i) => {
        const trigger = i.trigger as {
          type?: string;
          value?: number;
          hour?: number;
          minute?: number;
        } | null;
        const kind = typeof i.content.data?.kind === 'string' ? i.content.data.kind : undefined;
        return {
          id: i.identifier,
          title: i.content.title ?? '',
          body: i.content.body ?? '',
          ...(trigger?.type === 'date' && typeof trigger.value === 'number'
            ? { at: new Date(trigger.value) }
            : {}),
          ...(trigger?.type === 'daily' &&
          typeof trigger.hour === 'number' &&
          typeof trigger.minute === 'number'
            ? { daily: { hour: trigger.hour, minute: trigger.minute } }
            : {}),
          ...(kind ? { kind } : {}),
        };
      });
    },
  };
}

/**
 * ตั้งค่าตอนเปิดแอป: แจ้งเตือนขึ้นแม้แอปเปิดอยู่ · แตะแจ้งเตือน `briefing` → เรียก `onBriefing`
 * คืนฟังก์ชันยกเลิก (ไม่มีโมดูล = คืนฟังก์ชันว่าง ไม่ throw)
 */
export function setupNotifications(onBriefing: () => void): () => void {
  try {
    const N = lib();
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    const sub = N.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.kind === 'briefing') onBriefing();
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
