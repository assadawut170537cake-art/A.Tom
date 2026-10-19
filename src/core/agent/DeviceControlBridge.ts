/**
 * @file Device Control — ให้ agent สั่งงานอุปกรณ์ (เสียง ความสว่าง WiFi เปิดแอป คลิปบอร์ด หน้าตั้งค่า)
 *
 * Safety guards:
 * - **ปิดเป็นค่าเริ่มต้น** — บอสต้องเปิดเองในหน้า Marketplace (AsyncStorage `atom.device.v1.enabled`)
 * - ค่าระดับ (volume / brightness) ถูกบีบให้อยู่ใน 0–1 · ค่าที่ไม่ใช่ตัวเลข = ปฏิเสธ
 * - เปิดแอปได้เฉพาะ URL scheme ที่ไม่อยู่ใน {@link BLOCKED_SCHEMES} (โทร / SMS / ไฟล์ / javascript ฯลฯ) และเครื่องเปิดได้จริง
 * - ทุกคำสั่งไม่ throw: ไม่รองรับ / ล้ม → คืน ok:false พร้อมเหตุผลภาษาไทย
 *
 * ความสามารถจริงมาจาก {@link DeviceDriver} — ตัวเริ่มต้น ({@link defaultDriver}) = `Linking` (ตั้งค่า / WiFi / เปิดแอป)
 * + expo-brightness + expo-clipboard + native module `AtomDevice` ของเราเอง (`modules/atom-device`, Android: เสียง / ไฟฉาย)
 * — ADR-015 ระดับ A · ไม่มี native module (Expo Go / iOS / test) → เสียง + ไฟฉาย = "ยังไม่รองรับ"
 * Android 10+ / iOS ไม่ให้แอปเปิด-ปิด WiFi เอง → เปิดหน้าตั้งค่า WiFi ให้บอสกดเองแทน (ระดับ B AccessibilityService จะกดให้ได้)
 */

import * as Brightness from 'expo-brightness';
import * as Clipboard from 'expo-clipboard';
import { requireOptionalNativeModule } from 'expo';
import { Linking, Platform } from 'react-native';

import { redactSecrets } from '../http/errors';
import { readJSON, writeJSON } from '../storage/jsonStorage';
import { isBoolean, isNumber, isRecord } from '../types/guards';
import type { AgentToolCall, AgentToolProvider, AgentToolResult, AgentToolSpec } from './types';

export const DEVICE_ENABLED_KEY = 'atom.device.v1.enabled';
export const BLOCKED_SCHEMES = [
  'tel',
  'telprompt',
  'sms',
  'mailto',
  'javascript',
  'file',
  'content',
  'intent',
  'data',
  'about',
];

export interface DeviceDriver {
  setVolume?(level: number): Promise<void>;
  setTorch?(on: boolean): Promise<void>;
  setBrightness?(level: number): Promise<void>;
  setClipboard?(text: string): Promise<void>;
  openWifiSettings?(): Promise<void>;
  openSettings?(): Promise<void>;
  canOpenUrl?(url: string): Promise<boolean>;
  openUrl?(url: string): Promise<void>;
}

/** driver เริ่มต้น: React Native Linking เท่านั้น */
export const linkingDriver: DeviceDriver = {
  openSettings: () => Linking.openSettings(),
  openWifiSettings: async () => {
    if (Platform.OS === 'android') await Linking.sendIntent('android.settings.WIFI_SETTINGS');
    else await Linking.openSettings(); // iOS ไม่อนุญาตให้เปิดหน้า WiFi ตรง ๆ
  },
  canOpenUrl: (url) => Linking.canOpenURL(url),
  openUrl: async (url) => {
    await Linking.openURL(url);
  },
};

/**
 * Android: ความสว่างทั้งระบบต้องได้สิทธิ์ WRITE_SETTINGS (ขอครั้งแรกจะเปิดหน้าตั้งค่าให้บอสกดอนุญาต)
 * ไม่ได้สิทธิ์ → ตั้งแค่หน้าต่างแอป (กลับค่าเดิมเมื่อออกจากแอป) · iOS: setBrightnessAsync = ทั้งระบบอยู่แล้ว
 */
async function setScreenBrightness(level: number): Promise<void> {
  if (Platform.OS === 'android') {
    const current = await Brightness.getPermissionsAsync();
    const granted = current.granted || (await Brightness.requestPermissionsAsync()).granted;
    if (granted) {
      await Brightness.setSystemBrightnessAsync(level);
      return;
    }
  }
  await Brightness.setBrightnessAsync(level);
}

/** ฟังก์ชันของ `modules/atom-device` (Kotlin) — sync ฝั่ง JS · setTorch คืน false = เครื่องไม่มีแฟลช */
export interface AtomDeviceNative {
  setVolume(level: number): void;
  setTorch(on: boolean): boolean;
}

/** เติมเสียง / ไฟฉายเข้า driver เมื่อมี native module · ไม่มี → ไม่ใส่ (tool ขึ้น "ยังไม่รองรับ") */
export function nativeDriverParts(native: AtomDeviceNative | null): DeviceDriver {
  if (!native) return {};
  return {
    setVolume: async (level) => native.setVolume(level),
    setTorch: async (on) => {
      if (!native.setTorch(on)) throw new GuardError('เครื่องนี้ไม่มีไฟแฟลช');
    },
  };
}

/** driver ของแอป: Linking + expo-brightness + expo-clipboard + AtomDevice (ถ้ามี) */
export const defaultDriver: DeviceDriver = {
  ...linkingDriver,
  setBrightness: setScreenBrightness,
  setClipboard: async (text) => {
    await Clipboard.setStringAsync(text);
  },
  // type argument = trust boundary: รูปร่างมาจาก Kotlin (AtomDeviceModule.kt) ซึ่ง TS ตรวจไม่ได้
  ...nativeDriverParts(requireOptionalNativeModule<AtomDeviceNative>('AtomDevice')),
};

interface DeviceTool {
  id: string;
  name: string;
  description: string;
  supported: (d: DeviceDriver) => boolean;
  run: (d: DeviceDriver, call: AgentToolCall) => Promise<string>;
}

class GuardError extends Error {}

/** ระดับจาก args.level / target / text ("50%", "0.5") → 0–1 */
export function parseLevel(call: AgentToolCall): number {
  const raw = call.args && 'level' in call.args ? call.args.level : (call.target ?? call.text);
  const n = isNumber(raw) ? raw : Number.parseFloat(String(raw).replace('%', ''));
  if (!Number.isFinite(n)) throw new GuardError('ไม่เข้าใจระดับที่ต้องการ (ใส่ 0-100 หรือ 0-1)');
  const level = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, level));
}

/** เปิด/ปิด จาก args.on หรือข้อความ ("ปิดไฟฉาย", "on") — "เปิด" มี "ปิด" ซ้อนอยู่ จึงนับ "ปิด" เฉพาะที่ไม่ได้ตามหลัง "เ" */
export function parseOnOff(call: AgentToolCall): boolean {
  const raw = call.args?.on;
  if (isBoolean(raw)) return raw;
  const text = `${call.target ?? ''} ${call.text}`.toLowerCase();
  if (/(^|[^เ])ปิด|\boff\b|\bfalse\b/.test(text)) return false;
  if (/เปิด|\bon\b|\btrue\b/.test(text)) return true;
  throw new GuardError('ไม่เข้าใจว่าจะเปิดหรือปิด (ใส่ args.on เป็น true/false)');
}

/** ตรวจ URL ที่จะเปิด — scheme ต้องปลอดภัย */
export function checkAppUrl(url: string): string {
  const trimmed = url.trim();
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) throw new GuardError('ต้องระบุแอปเป็น URL เช่น spotify: หรือ https://...');
  if (BLOCKED_SCHEMES.includes(scheme))
    throw new GuardError(`ไม่อนุญาตให้ agent เปิด "${scheme}:" (ต้องให้บอสทำเอง)`);
  return trimmed;
}

const argString = (call: AgentToolCall, key: string) => {
  const v = call.args?.[key];
  return typeof v === 'string' ? v : undefined;
};

const DEVICE_TOOLS: DeviceTool[] = [
  {
    id: 'device.volume',
    name: 'ปรับเสียง',
    description: 'ตั้งระดับเสียง 0-100 (args.level)',
    supported: (d) => !!d.setVolume,
    run: async (d, call) => {
      const level = parseLevel(call);
      await d.setVolume?.(level);
      return `ตั้งเสียงเป็น ${Math.round(level * 100)}% แล้ว`;
    },
  },
  {
    id: 'device.brightness',
    name: 'ปรับความสว่าง',
    description: 'ตั้งความสว่างหน้าจอ 0-100 (args.level)',
    supported: (d) => !!d.setBrightness,
    run: async (d, call) => {
      const level = parseLevel(call);
      await d.setBrightness?.(level);
      return `ตั้งความสว่างเป็น ${Math.round(level * 100)}% แล้ว`;
    },
  },
  {
    id: 'device.flashlight',
    name: 'ไฟฉาย',
    description: 'เปิด/ปิดไฟฉาย (args.on true/false)',
    supported: (d) => !!d.setTorch,
    run: async (d, call) => {
      const on = parseOnOff(call);
      await d.setTorch?.(on);
      return on ? 'เปิดไฟฉายแล้ว' : 'ปิดไฟฉายแล้ว';
    },
  },
  {
    id: 'device.wifi',
    name: 'WiFi',
    description: 'เปิดหน้าตั้งค่า WiFi ให้บอสเปิด/ปิดเอง',
    supported: (d) => !!d.openWifiSettings,
    run: async (d) => {
      await d.openWifiSettings?.();
      return 'เปิดหน้าตั้งค่า WiFi แล้ว (ระบบไม่อนุญาตให้แอปเปิด/ปิด WiFi เอง)';
    },
  },
  {
    id: 'device.open_app',
    name: 'เปิดแอป',
    description: 'เปิดแอปหรือเว็บด้วย URL (args.url เช่น spotify: หรือ https://...)',
    supported: (d) => !!d.openUrl,
    run: async (d, call) => {
      const url = checkAppUrl(argString(call, 'url') ?? call.target ?? call.text);
      if (d.canOpenUrl && !(await d.canOpenUrl(url)))
        throw new GuardError('ไม่พบแอปที่เปิด URL นี้ได้ในเครื่อง');
      await d.openUrl?.(url);
      return `เปิด ${url} แล้ว`;
    },
  },
  {
    id: 'device.clipboard',
    name: 'คัดลอกข้อความ',
    description: 'คัดลอกข้อความไปคลิปบอร์ด (args.text)',
    supported: (d) => !!d.setClipboard,
    run: async (d, call) => {
      const text = argString(call, 'text') ?? call.text;
      await d.setClipboard?.(text.slice(0, 5_000));
      return 'คัดลอกไปคลิปบอร์ดแล้ว';
    },
  },
  {
    id: 'device.settings',
    name: 'ตั้งค่าแอป',
    description: 'เปิดหน้าตั้งค่าของแอปในเครื่อง',
    supported: (d) => !!d.openSettings,
    run: async (d) => {
      await d.openSettings?.();
      return 'เปิดหน้าตั้งค่าแล้ว';
    },
  },
];

export interface DeviceCapability {
  id: string;
  name: string;
  description: string;
  supported: boolean;
}

export class DeviceControlBridge implements AgentToolProvider {
  private enabled = false;
  private loaded: Promise<void> | null = null;

  constructor(private readonly driver: DeviceDriver = defaultDriver) {}

  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const raw = await readJSON(DEVICE_ENABLED_KEY, isRecord);
        this.enabled = raw !== null && isBoolean(raw.enabled) ? raw.enabled : false;
      } catch (e) {
        console.error('[device] อ่านค่าการควบคุมอุปกรณ์ไม่ได้ — ปิดไว้ก่อน', e);
        this.enabled = false;
      }
    })());
  }

  async isEnabled(): Promise<boolean> {
    await this.load();
    return this.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load();
    this.enabled = enabled;
    try {
      await writeJSON(DEVICE_ENABLED_KEY, { enabled });
    } catch (e) {
      console.error('[device] บันทึกค่าการควบคุมอุปกรณ์ไม่ได้', e);
    }
  }

  capabilities(): DeviceCapability[] {
    return DEVICE_TOOLS.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      supported: t.supported(this.driver),
    }));
  }

  listTools(): AgentToolSpec[] {
    if (!this.enabled) return [];
    return DEVICE_TOOLS.filter((t) => t.supported(this.driver)).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      source: 'device' as const,
    }));
  }

  async call(call: AgentToolCall): Promise<AgentToolResult> {
    await this.load();
    const tool = DEVICE_TOOLS.find((t) => t.id === call.tool);
    if (!tool) return { ok: false, output: `ไม่พบคำสั่งอุปกรณ์ "${call.tool}"` };
    if (!this.enabled)
      return { ok: false, output: 'การควบคุมอุปกรณ์ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า › Marketplace' };
    if (!tool.supported(this.driver))
      return { ok: false, output: `เครื่องนี้ยังไม่รองรับ "${tool.name}"` };
    try {
      return { ok: true, output: await tool.run(this.driver, call) };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        output: redactSecrets(
          e instanceof GuardError ? reason : `${tool.name} ไม่สำเร็จ: ${reason}`,
        ),
      };
    }
  }
}

/** ตัวเดียวทั้งแอป */
export const deviceControl = new DeviceControlBridge();
