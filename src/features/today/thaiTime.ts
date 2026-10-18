/**
 * @file แยก "เมื่อไร" ออกจากประโยคภาษาไทย (ไม่ใช้ LLM) — ใช้กับการเตือน / ลงปฏิทิน
 *
 * รองรับที่คนไทยพูดบ่อย:
 * - เวลานับจากตอนนี้: "อีก 10 นาที" · "อีกครึ่งชั่วโมง" · "อีก 2 ชั่วโมงครึ่ง" · "in 5 minutes"
 * - วัน: วันนี้ / พรุ่งนี้ / มะรืนนี้ / วันจันทร์…อาทิตย์ (+นี้/หน้า) · "พรุ่งนี้เช้า" "คืนนี้" (ไม่มีเลขเวลา)
 * - เวลา: "20:30" "8.15 น." · "9 โมง(เช้า|เย็น)" · "บ่าย 3" "บ่ายโมง" · "2 ทุ่ม" · "ตี 5" · "เที่ยง" "เที่ยงคืน"
 *   ตามด้วย "ครึ่ง" หรือ "15 นาที" ได้ · ตัวเลขเป็นคำไทยได้ (สาม, สิบเอ็ด)
 *
 * ไม่บอกวันแล้วเวลานั้นผ่านไปแล้ววันนี้ → เป็นของพรุ่งนี้ · "N โมง" เฉย ๆ 1–5 = บ่าย (คนไทยมักละ "บ่าย")
 * ไม่มี lookbehind / \p{} — ให้ทำงานบน Hermes ได้
 */

const NUM_WORDS: Readonly<Record<string, number>> = {
  หนึ่ง: 1,
  สอง: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
  หก: 6,
  เจ็ด: 7,
  แปด: 8,
  เก้า: 9,
  สิบ: 10,
  สิบเอ็ด: 11,
  สิบสอง: 12,
};
// ยาวก่อนสั้น — "สิบเอ็ด" ต้องไม่ถูกจับเป็น "สิบ"
const NUM = '(\\d{1,2}|สิบเอ็ด|สิบสอง|สิบ|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)';
const MINUTES_TAIL = '(?:\\s*(ครึ่ง|(\\d{1,2})\\s*นาที))?';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface ParsedWhen {
  /** epoch ms */
  at: number;
  /** ประโยคที่ตัดส่วนบอกเวลาออกแล้ว (อาจว่าง) */
  text: string;
}

const toNum = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUM_WORDS[raw] ?? null;
};

const tailMinutes = (half: string | undefined, minutes: string | undefined): number =>
  half === 'ครึ่ง' ? 30 : minutes ? Math.min(Number(minutes), 59) : 0;

interface Clock {
  hour: number;
  minute: number;
}

const DAY_WORDS: readonly { re: RegExp; offset: number; hour?: number }[] = [
  { re: /มะรืน(?:นี้)?/, offset: 2 },
  { re: /พรุ่งนี้/, offset: 1 },
  { re: /tomorrow/i, offset: 1 },
  { re: /วันนี้|today/i, offset: 0 },
  { re: /คืนนี้|tonight/i, offset: 0, hour: 20 },
  { re: /เย็นนี้/, offset: 0, hour: 18 },
  { re: /บ่ายนี้/, offset: 0, hour: 14 },
  { re: /เช้านี้/, offset: 0, hour: 8 },
];

/** ช่วงของวันที่ตามหลังคำบอกวัน เช่น "พรุ่งนี้เช้า" — ใช้เมื่อไม่มีเลขเวลา */
const PERIOD_AFTER_DAY: Readonly<Record<string, number>> = {
  เช้า: 8,
  สาย: 10,
  เที่ยง: 12,
  บ่าย: 14,
  เย็น: 18,
  ค่ำ: 19,
  คืน: 20,
};

// "บ่าย" ที่ตามด้วยเลข = เวลา ("พรุ่งนี้บ่าย 3") ให้ parseClock จับแทน
const PERIOD = `เช้า|สาย|เที่ยง(?!คืน)|บ่าย(?!\\s*(?:\\d|โมง|${NUM.slice(1, -1)}))|เย็น|ค่ำ|คืน`;

const WEEKDAYS: readonly [RegExp, number][] = [
  [/อาทิตย์/, 0],
  [/จันทร์/, 1],
  [/อังคาร/, 2],
  [/พุธ/, 3],
  [/พฤหัส(?:บดี)?/, 4],
  [/ศุกร์/, 5],
  [/เสาร์/, 6],
];

const FILLER_START = /^(?:ให้|ว่า|ตอน|เวลา|ช่วง|เมื่อ|ด้วย|นะ|หน่อย|ที|ไป|ครับ|ค่ะ|คะ|to|at|on)(?:\s+|$)|^[:,\-–—]\s*/i;
const FILLER_START_GLUED = /^(?:ให้|ว่า|ตอน|เวลา)/;
const FILLER_END = /(?:\s*)(?:นะ|ด้วย|หน่อย|ครับ|ค่ะ|คะ|จ้า|ให้|ตอน|เวลา|ช่วง|ใน|ที|น\.)$|\s+(?:at|on|to)$/i;

/** ตัดคำเชื่อม/คำลงท้ายที่เหลือหลังตัดเวลาออก เช่น "ให้ กินยา ด้วยนะ" → "กินยา" */
export function cleanText(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 6; i++) {
    const before = out;
    out = out.replace(FILLER_START, '').replace(FILLER_END, '').trim();
    // "ให้กินยา" (ติดกันไม่มีวรรค) — ตัดเฉพาะเมื่อเหลือคำหลังจากนั้น
    if (FILLER_START_GLUED.test(out) && out.replace(FILLER_START_GLUED, '').trim().length > 1) {
      out = out.replace(FILLER_START_GLUED, '').trim();
    }
    if (out === before) break;
  }
  return out;
}

/** ตัดส่วนที่ match ออกจากประโยค (แทนด้วยวรรค — คำที่อยู่สองข้างจะได้ไม่ติดกัน) */
function cut(text: string, re: RegExp): { rest: string; match: RegExpExecArray | null } {
  const match = re.exec(text);
  if (!match) return { rest: text, match: null };
  return { rest: `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`, match };
}

function parseRelative(text: string): { delta: number; rest: string } | null {
  const th = cut(text, new RegExp(`(?:(?:ใน)?อีก|ใน)\\s*(${NUM.slice(1, -1)}|ครึ่ง)\\s*(นาที|ชั่วโมง|ชม\\.?|วัน)\\s*(ครึ่ง)?`));
  if (th.match) {
    const [, rawValue, unit = '', halfTail] = th.match;
    const value = (rawValue === 'ครึ่ง' ? 0.5 : (toNum(rawValue) ?? 0)) + (halfTail ? 0.5 : 0);
    const size = unit === 'นาที' ? MINUTE : unit === 'วัน' ? DAY : HOUR;
    return value > 0 ? { delta: value * size, rest: th.rest } : null;
  }
  const en = cut(text, /\bin\s+(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
  if (en.match) {
    const value = Number(en.match[1]);
    const size = (en.match[2] ?? '').toLowerCase().startsWith('h') ? HOUR : MINUTE;
    return value > 0 ? { delta: value * size, rest: en.rest } : null;
  }
  return null;
}

/** เวลาบนนาฬิกา — คืน hour 0–24 (24 = เที่ยงคืนของวันถัดไป) */
function parseClock(text: string): { clock: Clock; rest: string } | null {
  const attempts: [RegExp, (m: RegExpExecArray) => Clock | null][] = [
    // 20:30 · 8.15 น. · 9.00 นาฬิกา
    [
      /(\d{1,2})[:.](\d{2})\s*(?:น\.|นาฬิกา)?/,
      (m) => {
        const hour = Number(m[1]);
        const minute = Number(m[2]);
        return hour <= 24 && minute < 60 ? { hour, minute } : null;
      },
    ],
    [/เที่ยงคืน|midnight/i, () => ({ hour: 24, minute: 0 })],
    [new RegExp(`เที่ยง(?:วัน|ตรง)?${MINUTES_TAIL}`), (m) => ({ hour: 12, minute: tailMinutes(m[1], m[2]) })],
    // บ่ายโมง · บ่าย 3 (โมง) (ครึ่ง)
    [
      new RegExp(`บ่าย\\s*(?:${NUM}\\s*(?:โมง)?|(โมง))${MINUTES_TAIL}`),
      (m) => {
        const n = m[2] ? 1 : toNum(m[1]);
        return n !== null && n >= 1 && n <= 6 ? { hour: 12 + n, minute: tailMinutes(m[3], m[4]) } : null;
      },
    ],
    // 2 ทุ่ม (6 ทุ่ม = เที่ยงคืน)
    [
      new RegExp(`${NUM}\\s*ทุ่ม${MINUTES_TAIL}`),
      (m) => {
        const n = toNum(m[1]);
        return n !== null && n >= 1 && n <= 6 ? { hour: 18 + n, minute: tailMinutes(m[2], m[3]) } : null;
      },
    ],
    // ตี 5
    [
      new RegExp(`ตี\\s*${NUM}${MINUTES_TAIL}`),
      (m) => {
        const n = toNum(m[1]);
        return n !== null && n >= 1 && n <= 5 ? { hour: n, minute: tailMinutes(m[2], m[3]) } : null;
      },
    ],
    // 9 โมง(เช้า|เย็น|ค่ำ) (ครึ่ง)
    [
      new RegExp(`${NUM}\\s*โมง\\s*(เช้า|เย็น|ค่ำ)?${MINUTES_TAIL}`),
      (m) => {
        const n = toNum(m[1]);
        if (n === null || n < 1 || n > 12) return null;
        const minute = tailMinutes(m[3], m[4]);
        if (m[2] === 'เย็น' || m[2] === 'ค่ำ') return { hour: n < 12 ? n + 12 : n, minute };
        if (m[2] === 'เช้า') return { hour: n, minute };
        return { hour: n <= 5 ? n + 12 : n, minute };
      },
    ],
    // 14 นาฬิกา
    [/(\d{1,2})\s*นาฬิกา/, (m) => (Number(m[1]) <= 24 ? { hour: Number(m[1]), minute: 0 } : null)],
    // 9pm · 9:30 am · at 7am
    [
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
      (m) => {
        const raw = Number(m[1]);
        if (raw < 1 || raw > 12) return null;
        const pm = (m[3] ?? '').toLowerCase() === 'pm';
        return { hour: (raw % 12) + (pm ? 12 : 0), minute: m[2] ? Number(m[2]) : 0 };
      },
    ],
  ];
  for (const [re, toClock] of attempts) {
    const { rest, match } = cut(text, re);
    if (!match) continue;
    const clock = toClock(match);
    if (clock) return { clock, rest };
  }
  return null;
}

interface DayPart {
  /** วันนับจากวันนี้ — null = ไม่ได้บอกวัน */
  offset: number | null;
  /** วันในสัปดาห์ 0–6 (อาทิตย์ = 0) */
  weekday: number | null;
  /** ชั่วโมงจากคำอย่าง "พรุ่งนี้เช้า" / "คืนนี้" (ใช้เมื่อไม่มีเลขเวลา) */
  periodHour: number | null;
  rest: string;
}

function parseDay(text: string): DayPart {
  let rest = text;
  let offset: number | null = null;
  let weekday: number | null = null;
  let periodHour: number | null = null;

  for (const word of DAY_WORDS) {
    const periodRe = new RegExp(`(?:วัน)?(?:${word.re.source})(${PERIOD})?`, word.re.flags);
    const res = cut(rest, periodRe);
    if (!res.match) continue;
    rest = res.rest;
    offset = word.offset;
    const period = res.match[1];
    periodHour = word.hour ?? (period ? (PERIOD_AFTER_DAY[period] ?? null) : null);
    break;
  }

  if (offset === null) {
    for (const [re, day] of WEEKDAYS) {
      // ต้องมี "วัน" นำหน้า หรือ "นี้/หน้า" ตามหลัง — กันคำอย่าง "พุธ" ในชื่อเฉพาะ
      const res = cut(rest, new RegExp(`(?:วัน(?:${re.source})(?:นี้|หน้า)?|(?:${re.source})(?:นี้|หน้า))(${PERIOD})?`));
      if (!res.match) continue;
      rest = res.rest;
      weekday = day;
      const period = res.match[1];
      periodHour = period ? (PERIOD_AFTER_DAY[period] ?? null) : null;
      break;
    }
  }
  return { offset, weekday, periodHour, rest };
}

/** เที่ยงคืนของวันที่ `ms` อยู่ (เวลาเครื่อง) */
function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atClock(base: Date, dayOffset: number, hour: number, minute: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0); // hour 24 → 00:00 ของวันถัดไป (Date จัดการให้)
  return d.getTime();
}

/**
 * หาเวลาในประโยค — ไม่พบ = null
 * @param now ใช้ใน test (ค่าเริ่มต้น = ตอนนี้)
 */
export function parseThaiWhen(input: string, now: number = Date.now()): ParsedWhen | null {
  const relative = parseRelative(input);
  if (relative) return { at: now + relative.delta, text: cleanText(relative.rest) };

  const day = parseDay(input);
  const clockPart = parseClock(day.rest);
  const rest = clockPart ? clockPart.rest : day.rest;
  if (!clockPart && day.offset === null && day.weekday === null) return null;

  let hour = clockPart?.clock.hour ?? day.periodHour ?? 9;
  // "พรุ่งนี้เย็น 6 โมง" — ช่วงบอกว่าเป็นหลังเที่ยง
  if (clockPart && day.periodHour !== null && day.periodHour >= 14 && hour < 12) hour += 12;
  const minute = clockPart?.clock.minute ?? 0;
  const today = startOfDay(now);

  let at: number;
  if (day.weekday !== null) {
    let diff = (day.weekday - today.getDay() + 7) % 7;
    at = atClock(today, diff, hour, minute);
    if (at <= now) {
      diff += 7;
      at = atClock(today, diff, hour, minute);
    }
  } else if (day.offset !== null) {
    at = atClock(today, day.offset, hour, minute);
  } else {
    at = atClock(today, 0, hour, minute);
    // ไม่บอกวันแล้วเวลาผ่านไปแล้ว = หมายถึงครั้งถัดไป
    if (at <= now) at = atClock(today, 1, hour, minute);
  }
  return { at, text: cleanText(rest) };
}

const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const;
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;
const TH_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

export const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "วันนี้ 14:30 น." · "พรุ่งนี้ 09:00 น." · "ศุกร์ 24 ต.ค. 09:00 น." */
export function formatWhen(at: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(at).getTime() - startOfDay(now).getTime()) / DAY);
  const d = new Date(at);
  const dayLabel =
    days === 0
      ? 'วันนี้'
      : days === 1
        ? 'พรุ่งนี้'
        : days === 2
          ? 'มะรืนนี้'
          : `${TH_DAYS[d.getDay()] ?? ''} ${d.getDate()} ${TH_MONTHS[d.getMonth()] ?? ''}`;
  return `${dayLabel} ${formatClock(at)} น.`;
}

/** "วันเสาร์ที่ 18 ตุลาคม" */
export function formatToday(now: number = Date.now()): string {
  const d = new Date(now);
  return `วัน${TH_DAYS[d.getDay()] ?? ''}ที่ ${d.getDate()} ${TH_MONTHS_FULL[d.getMonth()] ?? ''}`;
}

export { startOfDay, DAY as DAY_MS };
