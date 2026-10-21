const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = [
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
];

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 ตามเวลาท้องถิ่นของเครื่อง พร้อม offset เช่น 2026-10-21T16:20:00+07:00 */
export function toLocalISO(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** บริบทเวลาให้ LLM แปลง "พรุ่งนี้ 10 โมง" เป็นเวลาจริง */
export function nowContext(now: Date): string {
  return (
    `ตอนนี้คือวัน${WEEKDAYS[now.getDay()]}ที่ ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} ` +
    `เวลา ${pad(now.getHours())}:${pad(now.getMinutes())} (${toLocalISO(now)})`
  );
}

/** อ่านวันเวลาแบบสั้นให้เสียงอ่านได้ เช่น "วันพุธที่ 21 ตุลาคม เวลา 16:20" */
export function speakDate(date: Date): string {
  return `วัน${WEEKDAYS[date.getDay()]}ที่ ${date.getDate()} ${MONTHS[date.getMonth()]} เวลา ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function speakTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
