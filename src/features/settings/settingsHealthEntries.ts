/**
 * @file รายการ blob การตั้งค่าที่ให้ SettingsHealth เฝ้า (PR-4b) — อยู่ใน features/ เพราะอ้าง key ของหลายฟีเจอร์
 *
 * guard ของแต่ละ blob = เท่ากับหรือหลวมกว่า guard ที่โมดูลนั้นใช้อ่านจริง → ไม่กักกันของที่โมดูลยอมรับ
 * reset = ลบ key → โมดูลตกไปใช้ค่าเริ่มต้นของมันเอง (ปลอดภัย ไม่เขียนค่ามั่ว)
 * ⚠️ ไม่รวมคีย์ลับ (SecureStore) และประวัติแชท (ข้อมูลผู้ใช้ — ห้ามลบอัตโนมัติ)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MCP_SERVERS_KEY } from '../../core/agent/MCPClientBridge';
import { SKILLS_KEY } from '../../core/agent/SkillEngine';
import { MODULE_FLAGS_KEY } from '../../core/modules/ModuleManager';
import type { HealthEntry } from '../../core/selfRepair/SettingsHealth';
import { isArray, isBoolean, isRecord } from '../../core/types/guards';
import { CUSTOM_PROVIDERS_KEY, isCustomProviderList } from '../ai/customProviders';
import { STANDBY_STORAGE_KEY } from '../voice/live/standbyStore';

const clear = (key: string) => (): Promise<void> => AsyncStorage.removeItem(key);

/** blob ที่เฝ้า (ตอน boot) — อ่านครั้งเดียว ไม่วน */
export function settingsHealthEntries(): HealthEntry[] {
  return [
    {
      key: MODULE_FLAGS_KEY,
      label: 'โมดูลที่เปิดไว้',
      guard: isRecord,
      reset: clear(MODULE_FLAGS_KEY),
    },
    {
      key: CUSTOM_PROVIDERS_KEY,
      label: 'ผู้ให้บริการ AI ที่เพิ่มเอง',
      guard: isCustomProviderList,
      reset: clear(CUSTOM_PROVIDERS_KEY),
    },
    { key: MCP_SERVERS_KEY, label: 'รายการ MCP', guard: isArray, reset: clear(MCP_SERVERS_KEY) },
    { key: SKILLS_KEY, label: 'ทักษะ', guard: isArray, reset: clear(SKILLS_KEY) },
    {
      key: STANDBY_STORAGE_KEY,
      label: 'โหมดเฝ้า',
      guard: isBoolean,
      reset: clear(STANDBY_STORAGE_KEY),
    },
  ];
}
