/**
 * @file ค่าตั้งของ pc-bridge (ตั้งค่า › Mark 55 Bus)
 *
 * - Project URL → AsyncStorage (ไม่ลับ)
 * - anon/publishable key + token เครื่อง → SecureStore
 *   anon key ไม่ใช่ความลับจริง (ดึงจาก APK ได้) แต่เก็บคู่กับ token ไว้ที่เดียวกันให้ลบทีเดียวหมด
 *   ความปลอดภัยอยู่ที่ token เครื่อง — Supabase เก็บแค่ hash (mark55/sql/002_mobile_rpc.sql)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { SecureKeyStore, type KeyStore } from '../../core/storage/SecureKeyStore';

export const PC_BRIDGE_URL_KEY = 'atom.pcbridge.v1.url';
export const PC_BRIDGE_ANON_KEY = 'pcbridge.anonKey';
export const PC_BRIDGE_TOKEN_KEY = 'pcbridge.token';

export interface PcBridgeConfig {
  /** https://<project-ref>.supabase.co (ไม่มี / ท้าย) */
  url: string;
  anonKey: string;
  token: string;
}

/** token ที่ mobile_register_device() ออกให้ */
export const DEVICE_TOKEN_PATTERN = /^atm_[0-9a-f]{64}$/;

/**
 * ตรวจ + จัดรูป Project URL · คืนข้อความ error (ไทย) ถ้าใช้ไม่ได้
 * https เท่านั้น — token ส่งไปกับทุกคำขอ
 */
export function normalizeProjectUrl(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'Project URL ไม่ถูกต้อง — ตัวอย่าง https://<project-ref>.supabase.co' };
  }
  if (parsed.protocol !== 'https:') return { error: 'Project URL ต้องขึ้นต้นด้วย https://' };
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return { error: 'ใส่แค่ Project URL (ไม่ต้องมี /rest/v1) — ตัวอย่าง https://<project-ref>.supabase.co' };
  }
  return { url: parsed.origin };
}

export interface PcBridgeSettingsStore {
  load(): Promise<PcBridgeConfig | null>;
  save(config: PcBridgeConfig): Promise<void>;
  clear(): Promise<void>;
}

export function createPcBridgeSettings(secrets: KeyStore = SecureKeyStore): PcBridgeSettingsStore {
  return {
    /** null = ยังตั้งไม่ครบ 3 ค่า */
    async load() {
      const [url, anonKey, token] = await Promise.all([
        AsyncStorage.getItem(PC_BRIDGE_URL_KEY),
        secrets.get(PC_BRIDGE_ANON_KEY),
        secrets.get(PC_BRIDGE_TOKEN_KEY),
      ]);
      if (!url || !anonKey || !token) return null;
      return { url, anonKey, token };
    },
    async save({ url, anonKey, token }) {
      await AsyncStorage.setItem(PC_BRIDGE_URL_KEY, url);
      await secrets.set(PC_BRIDGE_ANON_KEY, anonKey);
      await secrets.set(PC_BRIDGE_TOKEN_KEY, token);
    },
    async clear() {
      await AsyncStorage.removeItem(PC_BRIDGE_URL_KEY);
      await secrets.delete(PC_BRIDGE_ANON_KEY);
      await secrets.delete(PC_BRIDGE_TOKEN_KEY);
    },
  };
}

export const pcBridgeSettings = createPcBridgeSettings();
