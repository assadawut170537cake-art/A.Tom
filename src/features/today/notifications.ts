/**
 * @file ตั้งแจ้งเตือนของเครื่องด้วย expo-notifications (local เท่านั้น — ไม่มี push server)
 *
 * Android 8+ ต้องมี channel ก่อน (สร้างครั้งเดียว) · Android 13+ ต้องขอสิทธิ์ POST_NOTIFICATIONS
 * Android 12+ ไม่ได้สิทธิ์ exact alarm → ระบบอาจเลื่อนเวลาเด้งไปไม่กี่นาที (ยอมรับได้สำหรับเตือนความจำ)
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ReminderStore, type ReminderScheduler } from './reminderStore';

export const REMINDER_CHANNEL_ID = 'reminders';

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'เตือนความจำ',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  })
    .then(() => undefined)
    .catch((e: unknown) => {
      channelReady = null; // ครั้งหน้าลองใหม่
      throw e;
    });
  return channelReady;
}

async function ensurePermission(): Promise<void> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return;
  const asked = await Notifications.requestPermissionsAsync();
  if (!asked.granted) {
    throw new Error('ยังไม่ได้อนุญาตการแจ้งเตือน — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › การแจ้งเตือน');
  }
}

let handlerInstalled = false;

/** ให้แจ้งเตือนเด้งแม้เปิดแอปอยู่ (ค่าเริ่มต้นของ expo คือไม่โชว์ตอนแอปอยู่หน้าจอ) */
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export const notificationScheduler: ReminderScheduler = {
  async schedule({ id, text, at }) {
    await ensurePermission();
    await ensureChannel();
    return Notifications.scheduleNotificationAsync({
      content: { title: 'A.T.O.M. เตือนความจำ', body: text, data: { reminderId: id }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: REMINDER_CHANNEL_ID },
    });
  },
  cancel: (notificationId) => Notifications.cancelScheduledNotificationAsync(notificationId),
};

/** ที่เก็บตัวเดียวทั้งแอป (agent "เตือน" + แท็บ Today ใช้ร่วมกัน) */
export const reminderStore = new ReminderStore(notificationScheduler);
