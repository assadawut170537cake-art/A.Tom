/**
 * @file Reminder & Alarm Tool: เตือนความจำและตั้งนาฬิกาปลุกบนเครื่องผ่าน expo-notifications & IntentLauncher
 */

import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

export interface ReminderItem {
  id: string;
  title: string;
  body?: string;
  triggerDate: Date;
}

export async function scheduleReminder(title: string, triggerDate: Date, body?: string): Promise<string> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('ไม่ได้รับสิทธิ์การแจ้งเตือน');
  }

  const seconds = Math.max(1, Math.floor((triggerDate.getTime() - Date.now()) / 1000));

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: body || 'A.T.O.M. แจ้งเตือนตามนัดหมาย',
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });

  return id;
}

export async function setDeviceAlarm(params: {
  hour: number;
  minutes: number;
  message?: string;
  skipUi?: boolean;
}): Promise<{ success: boolean; note: string }> {
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
        extra: {
          'android.intent.extra.alarm.HOUR': params.hour,
          'android.intent.extra.alarm.MINUTES': params.minutes,
          'android.intent.extra.alarm.MESSAGE': params.message || 'A.T.O.M. Alarm',
          'android.intent.extra.alarm.SKIP_UI': params.skipUi ?? false,
        },
      });
      return { success: true, note: `ตั้งนาฬิกาปลุก ${params.hour.toString().padStart(2, '0')}:${params.minutes.toString().padStart(2, '0')} เรียบร้อยแล้ว` };
    } catch {
      // Fallback เป็น Notification ถ้าตั้งปลุกระบบ Android ไม่สำเร็จ
      const alarmDate = new Date();
      alarmDate.setHours(params.hour, params.minutes, 0, 0);
      if (alarmDate.getTime() <= Date.now()) {
        alarmDate.setDate(alarmDate.getDate() + 1); // ข้ามไปวันพรุ่งนี้
      }
      await scheduleReminder(`⏰ ปลุก: ${params.message || 'ถึงเวลาแล้ว'}`, alarmDate);
      return { success: true, note: `ตั้งเตือนเวลา ${params.hour.toString().padStart(2, '0')}:${params.minutes.toString().padStart(2, '0')} ผ่านระบบ Notification` };
    }
  }

  // iOS Fallback Notification
  const alarmDate = new Date();
  alarmDate.setHours(params.hour, params.minutes, 0, 0);
  if (alarmDate.getTime() <= Date.now()) {
    alarmDate.setDate(alarmDate.getDate() + 1);
  }
  await scheduleReminder(`⏰ ${params.message || 'ปลุก'}`, alarmDate);
  const timeStr = `${params.hour.toString().padStart(2, '0')}:${params.minutes.toString().padStart(2, '0')}`;
  return { success: true, note: `ตั้งเตือนเวลา ${timeStr} บน iOS เรียบร้อย` };
}
