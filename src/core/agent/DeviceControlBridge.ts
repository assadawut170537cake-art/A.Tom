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
 *
 * ระดับ B (AccessibilityService ใน `modules/atom-device`): ปุ่มระบบ · กดตามข้อความ · พิมพ์ · อ่านจอ — บอสต้องเปิดสิทธิ์เอง
 * - ทำงานกับ **แอปที่อยู่หน้าสุด** — สั่งจากในแอปเรา = กดในแอปเรา → ใช้คู่กับ `device.launch` ("เปิดแอป X แล้วกด Y")
 * - กดปุ่มที่ข้อความเข้าข่าย {@link RISKY_TAP} (ซื้อ/โอน/ลบ/ส่ง…) ต้อง `args.confirmed === true` ไม่งั้นคืน `needsConfirmation`
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
  /** เปิดแอปตามชื่อที่เห็นบนหน้าจอหลัก — คืนชื่อแอปที่เปิด, "" = ไม่พบ */
  launchApp?(query: string): Promise<string>;
  accessibilityEnabled?(): Promise<boolean>;
  openAccessibilitySettings?(): Promise<void>;
  globalAction?(action: NavAction): Promise<boolean>;
  /** รหัสผลจาก Kotlin: ok · no_service · no_window · not_found · not_clickable · failed */
  tapText?(text: string, timeoutMs: number): Promise<string>;
  /** รหัสผลจาก Kotlin: ok · no_service · no_window · no_field · failed */
  typeText?(text: string): Promise<string>;
  /** null = ยังไม่เปิดสิทธิ์ */
  readScreen?(): Promise<string | null>;
}

export const NAV_ACTIONS = [
  'back',
  'home',
  'recents',
  'notifications',
  'quick_settings',
  'lock',
  'screenshot',
] as const;
export type NavAction = (typeof NAV_ACTIONS)[number];

/** คำ (ไทย/อังกฤษ) → ปุ่มระบบ · ใช้ทั้งใน tool และ agent */
export const NAV_WORDS: { action: NavAction; label: string; pattern: RegExp }[] = [
  { action: 'back', label: 'ย้อนกลับ', pattern: /ย้อนกลับ|\bback\b/i },
  { action: 'home', label: 'กลับหน้าโฮม', pattern: /หน้าโฮม|โฮม|\bhome\b/i },
  { action: 'recents', label: 'เปิดแอปล่าสุด', pattern: /แอปล่าสุด|สลับแอป|\brecents?\b/i },
  { action: 'notifications', label: 'เปิดแจ้งเตือน', pattern: /แจ้งเตือน|\bnotifications?\b/i },
  {
    action: 'quick_settings',
    label: 'เปิดตั้งค่าด่วน',
    pattern: /ตั้งค่าด่วน|\bquick\s*settings\b/i,
  },
  { action: 'lock', label: 'ล็อกหน้าจอ', pattern: /ล็อก|ล็อค|\block\b/i },
  { action: 'screenshot', label: 'แคปหน้าจอ', pattern: /แคป|จับภาพ|\bscreenshot\b/i },
];

/** ข้อความบนปุ่มที่กดแล้วอาจเสียเงิน/เสียข้อมูล/ส่งของออกไป → ต้องให้บอสยืนยันก่อน */
export const RISKY_TAP =
  /ซื้อ|ชำระ|จ่าย|โอน|ถอน|ลบ|ส่ง|ยืนยัน|ตกลง|สั่ง|buy|pay|purchase|checkout|order|transfer|withdraw|delete|remove|send|confirm|submit/i;

export const ACCESSIBILITY_OFF_REPLY =
  'ยังไม่ได้เปิดสิทธิ์ "การช่วยเหลือพิเศษ" ให้ A.T.O.M. — พิมพ์ "เปิดสิทธิ์ควบคุมมือถือ" แล้วเลือก "A.T.O.M. ควบคุมเครื่อง"';

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

/**
 * ฟังก์ชันของ `modules/atom-device` (Kotlin) — sync ฝั่ง JS ยกเว้น tapText · setTorch คืน false = เครื่องไม่มีแฟลช
 * ฟังก์ชันระดับ B เป็น optional เพราะ APK ที่ build ก่อนหน้านี้มีแค่ setVolume / setTorch
 */
export interface AtomDeviceNative {
  setVolume(level: number): void;
  setTorch(on: boolean): boolean;
  launchApp?(query: string): string;
  isAccessibilityEnabled?(): boolean;
  openAccessibilitySettings?(): void;
  globalAction?(action: string): boolean;
  tapText?(text: string, timeoutMs: number): Promise<string>;
  typeText?(text: string): string;
  readScreen?(): string | null;
}

/** เติมความสามารถของ native module เข้า driver · ไม่มี module / ฟังก์ชันไหนไม่มี → ไม่ใส่ (tool ขึ้น "ยังไม่รองรับ") */
export function nativeDriverParts(native: AtomDeviceNative | null): DeviceDriver {
  if (!native) return {};
  const parts: DeviceDriver = {
    setVolume: async (level) => native.setVolume(level),
    setTorch: async (on) => {
      if (!native.setTorch(on)) throw new GuardError('เครื่องนี้ไม่มีไฟแฟลช');
    },
  };
  const {
    launchApp,
    isAccessibilityEnabled,
    openAccessibilitySettings,
    globalAction,
    tapText,
    typeText,
    readScreen,
  } = native;
  if (launchApp) parts.launchApp = async (query) => launchApp(query);
  if (isAccessibilityEnabled) parts.accessibilityEnabled = async () => isAccessibilityEnabled();
  if (openAccessibilitySettings)
    parts.openAccessibilitySettings = async () => openAccessibilitySettings();
  if (globalAction) parts.globalAction = async (action) => globalAction(action);
  if (tapText) parts.tapText = (text, timeoutMs) => tapText(text, timeoutMs);
  if (typeText) parts.typeText = async (text) => typeText(text);
  if (readScreen) parts.readScreen = async () => readScreen();
  return parts;
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

/** ต้องให้บอสยืนยันก่อน — call() แปลงเป็น `needsConfirmation: true` */
class ConfirmationRequired extends Error {}

async function requireAccessibility(d: DeviceDriver): Promise<void> {
  if (!(await d.accessibilityEnabled?.())) throw new GuardError(ACCESSIBILITY_OFF_REPLY);
}

const TAP_RESULT: Record<string, (text: string) => string> = {
  no_service: () => ACCESSIBILITY_OFF_REPLY,
  no_window: () => 'ยังอ่านหน้าจอไม่ได้ — ลองสั่งใหม่อีกครั้ง',
  not_found: (t) => `ไม่พบ "${t}" บนหน้าจอ`,
  not_clickable: (t) => `เจอ "${t}" แต่กดไม่ได้`,
  no_field: () => 'ไม่มีช่องพิมพ์ที่เลือกอยู่ — แตะช่องพิมพ์ก่อน หรือสั่ง "กด <ชื่อช่อง>"',
  failed: (t) => `สั่ง "${t}" ไม่สำเร็จ`,
};

/** แปลงรหัสผลจาก Kotlin — ไม่ใช่ "ok" = throw ข้อความไทย */
function expectOk(code: string, text: string): void {
  if (code === 'ok') return;
  throw new GuardError(
    (TAP_RESULT[code] ?? TAP_RESULT.failed)?.(text) ?? `สั่ง "${text}" ไม่สำเร็จ`,
  );
}

/** ปุ่มระบบจาก args.action หรือคำในข้อความ ("กดย้อนกลับ", "home") */
export function parseNavAction(call: AgentToolCall): NavAction {
  const raw = call.args?.action;
  const direct = NAV_ACTIONS.find((a) => a === raw);
  if (direct) return direct;
  const text = `${call.target ?? ''} ${call.text}`;
  const hit = NAV_WORDS.find((w) => w.pattern.test(text));
  if (!hit)
    throw new GuardError(`ไม่รู้จักปุ่มนี้ — ใช้ได้: ${NAV_WORDS.map((w) => w.label).join(' / ')}`);
  return hit.action;
}

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
    id: 'device.launch',
    name: 'เปิดแอปตามชื่อ',
    description: 'เปิดแอปตามชื่อที่เห็นบนหน้าจอหลัก (args.name เช่น "LINE", "YouTube")',
    supported: (d) => !!d.launchApp,
    run: async (d, call) => {
      const name = (argString(call, 'name') ?? call.target ?? call.text).trim();
      if (!name) throw new GuardError('ต้องบอกชื่อแอป เช่น "เปิดแอป LINE"');
      const opened = await d.launchApp?.(name);
      if (!opened) throw new GuardError(`ไม่พบแอปชื่อ "${name}" ในเครื่อง`);
      return `เปิด ${opened} แล้ว`;
    },
  },
  {
    id: 'device.nav',
    name: 'ปุ่มระบบ',
    description:
      'ย้อนกลับ / หน้าโฮม / แอปล่าสุด / แจ้งเตือน / ตั้งค่าด่วน / ล็อกจอ / แคปจอ (args.action)',
    supported: (d) => !!d.globalAction,
    run: async (d, call) => {
      const action = parseNavAction(call);
      await requireAccessibility(d);
      if (!(await d.globalAction?.(action)))
        throw new GuardError('เครื่องนี้ทำคำสั่งนี้ไม่ได้ (ต้อง Android 9 ขึ้นไปสำหรับล็อก/แคปจอ)');
      return `${NAV_WORDS.find((w) => w.action === action)?.label ?? action}แล้ว`;
    },
  },
  {
    id: 'device.tap',
    name: 'กดบนหน้าจอ',
    description:
      'กดปุ่ม/ข้อความบนแอปที่อยู่หน้าสุด (args.text) · ปุ่มเสี่ยง (ซื้อ/โอน/ลบ/ส่ง) ระบบจะถามบอสยืนยันเอง',
    supported: (d) => !!d.tapText,
    run: async (d, call) => {
      const text = (argString(call, 'text') ?? call.target ?? call.text).trim();
      if (!text) throw new GuardError('ต้องบอกว่าจะกดอะไร เช่น "กดปุ่ม ถัดไป"');
      if (RISKY_TAP.test(text) && call.args?.confirmed !== true) {
        throw new ConfirmationRequired(
          `⚠️ "${text}" อาจเป็นคำสั่งสำคัญ (ซื้อ/โอน/ลบ/ส่ง) — พิมพ์ "ยืนยัน" ภายใน 1 นาทีเพื่อกด หรือ "ยกเลิก"`,
        );
      }
      await requireAccessibility(d);
      const timeoutMs = isNumber(call.args?.timeoutMs) ? call.args.timeoutMs : 0;
      expectOk((await d.tapText?.(text, timeoutMs)) ?? 'failed', text);
      return `กด "${text}" แล้ว`;
    },
  },
  {
    id: 'device.type',
    name: 'พิมพ์ข้อความ',
    description: 'ใส่ข้อความลงช่องที่เลือกอยู่ในแอปหน้าสุด (args.text)',
    supported: (d) => !!d.typeText,
    run: async (d, call) => {
      const text = argString(call, 'text') ?? call.text;
      if (!text) throw new GuardError('ต้องบอกข้อความที่จะพิมพ์ เช่น "พิมพ์ว่า สวัสดี"');
      await requireAccessibility(d);
      expectOk((await d.typeText?.(text.slice(0, 5_000))) ?? 'failed', text);
      return 'พิมพ์แล้ว';
    },
  },
  {
    id: 'device.read_screen',
    name: 'อ่านหน้าจอ',
    description: 'ข้อความที่มองเห็นบนแอปหน้าสุด',
    supported: (d) => !!d.readScreen,
    run: async (d) => {
      await requireAccessibility(d);
      const text = (await d.readScreen?.())?.trim();
      return text ? `บนหน้าจอมี:\n${text}` : 'หน้าจอไม่มีข้อความให้อ่าน';
    },
  },
  {
    id: 'device.accessibility_settings',
    name: 'เปิดสิทธิ์ควบคุมเครื่อง',
    description: 'เปิดหน้าตั้งค่า การช่วยเหลือพิเศษ ให้บอสเปิดสิทธิ์ A.T.O.M.',
    supported: (d) => !!d.openAccessibilitySettings,
    run: async (d) => {
      if (await d.accessibilityEnabled?.()) return 'เปิดสิทธิ์ควบคุมเครื่องไว้แล้ว';
      await d.openAccessibilitySettings?.();
      return 'เปิดหน้าการช่วยเหลือพิเศษแล้ว — เลือก "A.T.O.M. ควบคุมเครื่อง" แล้วเปิดสวิตช์';
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
      return { ok: false, output: 'การควบคุมอุปกรณ์ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า › Modules › Marketplace' };
    if (!tool.supported(this.driver))
      return { ok: false, output: `เครื่องนี้ยังไม่รองรับ "${tool.name}"` };
    try {
      return { ok: true, output: await tool.run(this.driver, call) };
    } catch (e) {
      if (e instanceof ConfirmationRequired)
        return { ok: false, output: e.message, needsConfirmation: true };
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
