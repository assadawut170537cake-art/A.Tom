/**
 * @file ตั้งปลุก / ตั้งเวลานับถอยหลัง / อ่านคลิปบอร์ด
 *
 * ใช้ Intent ของแอปนาฬิกาในเครื่อง (Android: ACTION_SET_ALARM / ACTION_SET_TIMER, ข้าม UI) — ไม่เขียนนาฬิกาเอง
 * iOS ไม่มี intent แบบนี้ → บอกตรง ๆ ว่ายังไม่รองรับ · parser เวลาไทยเขียนเอง (ไม่ต้องเรียก LLM = ฟรี ออฟไลน์ได้)
 */

import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

import type { AgentDefinition } from '../../../core/agents/types';
import { AssistantError, loadNative } from '../shared/errors';

export const CLOCK_AGENT_ID = 'clock';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
/** แปลงเลขไทย → อารบิก */
function normalizeDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * เวลานาฬิกาจากประโยคไทย: "7:30", "ตี 5", "6 โมงเช้า", "6 โมงครึ่ง", "บ่าย 2", "4 โมงเย็น", "2 ทุ่ม", "เที่ยง", "เที่ยงคืน"
 * คืน null ถ้าอ่านไม่ออก
 */
export function parseClock(raw: string): { hour: number; minute: number } | null {
  const text = normalizeDigits(raw);
  const colon = text.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour <= 23 && minute <= 59) return { hour: applyPeriod(hour, text), minute };
  }
  if (/เที่ยงคืน/.test(text)) return { hour: 0, minute: 0 };
  if (/เที่ยง/.test(text)) return { hour: 12, minute: /ครึ่ง/.test(text) ? 30 : 0 };
  const half = /ครึ่ง/.test(text) ? 30 : 0;
  const tee = text.match(/ตี\s*(\d{1,2})/);
  if (tee) return { hour: Number(tee[1]) % 24, minute: half };
  const thum = text.match(/(\d{1,2})\s*ทุ่ม/) ?? text.match(/ทุ่ม\s*(\d{1,2})/);
  if (thum) return { hour: (18 + Number(thum[1])) % 24, minute: half }; // 1 ทุ่ม = 19:00
  const baai = text.match(/บ่าย\s*(\d{1,2})/);
  if (baai) return { hour: (Number(baai[1]) % 12) + 12, minute: half };
  const mong = text.match(/(\d{1,2})\s*โมง/);
  if (mong) {
    const base = Number(mong[1]);
    const hour = /เย็น/.test(text) ? (base % 12) + 12 : /บ่าย/.test(text) ? (base % 12) + 12 : base;
    return { hour: hour % 24, minute: half };
  }
  return null;
}

/** "7:30 ตอนเย็น" → 19:30 · เลข 13–23 ใช้ตามนั้น */
function applyPeriod(hour: number, text: string): number {
  if (hour >= 13) return hour;
  if (/เย็น|บ่าย|ค่ำ|กลางคืน|pm/i.test(text) && hour < 12) return hour + 12;
  return hour;
}

/** ระยะเวลาเป็นวินาที: "10 นาที", "1 ชั่วโมง 30 นาที", "ครึ่งชั่วโมง", "90 วินาที" */
export function parseDuration(raw: string): number | null {
  const text = normalizeDigits(raw);
  let seconds = 0;
  let found = false;
  const add = (re: RegExp, unit: number) => {
    for (const m of text.matchAll(re)) {
      seconds += Number(m[1]) * unit;
      found = true;
    }
  };
  add(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|ชม\.?|hours?|hrs?|h\b)/gi, 3600);
  add(/(\d+(?:\.\d+)?)\s*(?:นาที|min)/gi, 60);
  add(/(\d+(?:\.\d+)?)\s*(?:วินาที|วิ|sec)/gi, 1);
  if (/ครึ่งชั่วโมง/.test(text)) {
    seconds += 1800;
    found = true;
  }
  return found && seconds > 0 ? Math.round(seconds) : null;
}

export function describeDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return (
    [h && `${h} ชั่วโมง`, m && `${m} นาที`, s && `${s} วินาที`].filter(Boolean).join(' ') ||
    '0 วินาที'
  );
}

export type LaunchIntent = (
  action: string,
  extra: Record<string, string | number | boolean>,
) => Promise<void>;

const defaultLaunch: LaunchIntent = async (action, extra) => {
  const launcher = loadNative(
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    () => require('expo-intent-launcher') as typeof import('expo-intent-launcher'),
    'ปลุก/ตั้งเวลา',
  );
  await launcher.startActivityAsync(action, { extra });
};

export interface ClockDeps {
  launch?: LaunchIntent;
  platform?: string;
  readClipboard?: () => Promise<string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function createClockAgent(deps: ClockDeps = {}): AgentDefinition {
  const launch = deps.launch ?? defaultLaunch;
  const platform = deps.platform ?? Platform.OS;
  const readClipboard = deps.readClipboard ?? (() => Clipboard.getStringAsync());

  const requireAndroid = () => {
    if (platform !== 'android')
      throw new AssistantError('การตั้งปลุก/จับเวลาอัตโนมัติรองรับเฉพาะ Android ครับ');
  };

  return {
    id: CLOCK_AGENT_ID,
    name: 'นาฬิกา',
    description: 'ตั้งปลุก ตั้งเวลานับถอยหลัง อ่านคลิปบอร์ด',
    capabilities: [
      {
        id: 'alarm.set',
        label: 'ตั้งปลุก',
        patterns: [
          /^(?:ช่วย)?ตั้ง(?:นาฬิกา)?ปลุก(?:ตอน|เวลา|ที่)?\s*(?<command>.+)$/,
          /^ปลุก(?:ฉัน|ผม|หน่อย)?\s*(?:ตอน|เวลา)?\s*(?<command>.*(?:โมง|ตี\s*\d|ทุ่ม|เที่ยง|\d{1,2}\s*[:.]\s*\d{2}).*)$/,
        ],
        examples: ['ตั้งปลุก 6 โมงครึ่ง', 'ปลุกตอนตี 5'],
      },
      {
        id: 'timer.set',
        label: 'ตั้งเวลานับถอยหลัง',
        patterns: [
          /^(?:ช่วย)?ตั้ง(?:เวลา|ไทเมอร์|ตัวจับเวลา|timer|นับถอยหลัง)\s*(?<command>.+)$/i,
          /^จับเวลา\s*(?<command>.+)$/,
        ],
        examples: ['ตั้งเวลา 10 นาที', 'จับเวลา 1 ชั่วโมง 30 นาที'],
      },
      {
        id: 'clipboard.read',
        label: 'อ่านคลิปบอร์ด',
        patterns: [
          /^อ่าน(?:ข้อความใน)?คลิปบอร์ด(?:ให้หน่อย|ให้ฟัง)?$/,
          /^(?:ในคลิปบอร์ด|คลิปบอร์ด)มีอะไร$/,
        ],
        examples: ['อ่านคลิปบอร์ด'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'clipboard.read') {
        const text = (await readClipboard()).trim();
        if (!text) return { reply: 'คลิปบอร์ดว่างอยู่ครับ' };
        return {
          reply: text.length > 300 ? `${text.slice(0, 300)} … (ยาว ${text.length} ตัวอักษร)` : text,
        };
      }
      requireAndroid();
      if (capabilityId === 'timer.set') {
        const seconds = parseDuration(commandText);
        if (!seconds)
          throw new AssistantError(
            'ไม่เข้าใจระยะเวลาครับ — เช่น “10 นาที” หรือ “1 ชั่วโมง 30 นาที”',
          );
        await launch('android.intent.action.SET_TIMER', {
          'android.intent.extra.alarm.LENGTH': seconds,
          'android.intent.extra.alarm.SKIP_UI': true,
        });
        return { reply: `ตั้งเวลานับถอยหลัง ${describeDuration(seconds)} แล้วครับ` };
      }
      const clock = parseClock(commandText);
      if (!clock)
        throw new AssistantError('ไม่เข้าใจเวลาครับ — เช่น “6 โมงครึ่ง” “ตี 5” หรือ “7:30”');
      await launch('android.intent.action.SET_ALARM', {
        'android.intent.extra.alarm.HOUR': clock.hour,
        'android.intent.extra.alarm.MINUTES': clock.minute,
        'android.intent.extra.alarm.MESSAGE': 'A.T.O.M.',
        'android.intent.extra.alarm.SKIP_UI': true,
      });
      return { reply: `ตั้งปลุก ${pad(clock.hour)}:${pad(clock.minute)} น. แล้วครับ` };
    },
  };
}
