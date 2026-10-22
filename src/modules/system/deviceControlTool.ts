/**
 * @file Device Control Tool: ควบคุมการตั้งค่าอุปกรณ์ Android / iOS (WiFi, Bluetooth, แสง, เสียง)
 */

import * as Brightness from 'expo-brightness';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

export type SettingTarget =
  | 'wifi'
  | 'bluetooth'
  | 'sound'
  | 'display'
  | 'battery'
  | 'airplane'
  | 'location'
  | 'apps';

const ANDROID_SETTINGS_MAP: Record<SettingTarget, string> = {
  wifi: 'android.settings.WIFI_SETTINGS',
  bluetooth: 'android.settings.BLUETOOTH_SETTINGS',
  sound: 'android.settings.SOUND_SETTINGS',
  display: 'android.settings.DISPLAY_SETTINGS',
  battery: 'android.settings.BATTERY_SAVER_SETTINGS',
  airplane: 'android.settings.AIRPLANE_MODE_SETTINGS',
  location: 'android.settings.LOCATION_SOURCE_SETTINGS',
  apps: 'android.settings.APPLICATION_SETTINGS',
};

export async function openDeviceSettings(target: SettingTarget): Promise<{ success: boolean; message: string }> {
  if (Platform.OS === 'android') {
    const action = ANDROID_SETTINGS_MAP[target] || 'android.settings.SETTINGS';
    try {
      await IntentLauncher.startActivityAsync(action);
      return { success: true, message: `เปิดหน้าตั้งค่า ${target} แล้ว` };
    } catch {
      await IntentLauncher.startActivityAsync('android.settings.SETTINGS');
      return { success: true, message: 'เปิดหน้าตั้งค่าหลักแล้ว' };
    }
  }

  // iOS App Settings
  await Linking.openSettings();
  return { success: true, message: `เปิดหน้าการตั้งค่า ${target} แล้ว` };
}

export async function setScreenBrightness(levelPercent: number): Promise<{ success: boolean; level: number }> {
  const normalized = Math.max(0, Math.min(100, levelPercent)) / 100;
  const { status } = await Brightness.requestPermissionsAsync();
  if (status === 'granted') {
    await Brightness.setBrightnessAsync(normalized);
    return { success: true, level: Math.round(normalized * 100) };
  }
  throw new Error('ไม่ได้รับสิทธิ์ปรับความสว่างหน้าจอ');
}
