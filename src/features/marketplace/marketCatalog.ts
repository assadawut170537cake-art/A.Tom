/**
 * @file จัดหน้า Marketplace แบบ "ของคุณ / สำรวจ" + หมวดหมู่ (เลียนหน้า ปรับแต่ง ของ Claude ที่บอสส่งรูปมา · ADR-021)
 * แยกจาก UI ให้ test ตรง ๆ ได้ · หมวดเดาจากคำในชื่อ/คำอธิบาย (ไม่มีหมวดในข้อมูลต้นทาง)
 */

import type { MarketEntry, MarketKind } from './marketplaceModel';

export type MarketTab = 'skill' | 'connector' | 'plugin';
export type MarketScope = 'mine' | 'explore';
export type MarketSort = 'name' | 'enabled';

export const MARKET_TABS: { id: MarketTab; label: string; kinds: readonly MarketKind[] }[] = [
  { id: 'skill', label: 'ทักษะ', kinds: ['skill'] },
  { id: 'connector', label: 'ตัวเชื่อมต่อ', kinds: ['mcp'] },
  { id: 'plugin', label: 'ปลั๊กอิน', kinds: ['plugin', 'device'] },
];

export interface MarketCategory {
  id: string;
  label: string;
  icon: string;
  match: RegExp;
  /** คำค้นในคลัง MCP เมื่อแตะหมวดในแท็บตัวเชื่อมต่อ */
  search: string;
}

export const MARKET_CATEGORIES: readonly MarketCategory[] = [
  {
    id: 'code',
    label: 'วิศวกรรมและโค้ด',
    icon: '</>',
    match: /code|โค้ด|git|dev|program|sql|deploy|api\b/i,
    search: 'code',
  },
  {
    id: 'files',
    label: 'ไฟล์และเอกสาร',
    icon: '📄',
    match: /file|doc|pdf|drive|note|notion|obsidian|เอกสาร|ไฟล์|โน้ต|สรุป/i,
    search: 'docs',
  },
  {
    id: 'data',
    label: 'ข้อมูลและวิเคราะห์',
    icon: '📊',
    match: /data|analy|database|chart|sheet|ข้อมูล|วิเคราะห์/i,
    search: 'data',
  },
  {
    id: 'comm',
    label: 'สื่อสาร',
    icon: '💬',
    match: /mail|slack|chat|message|line|discord|telegram|ข้อความ|อีเมล/i,
    search: 'email',
  },
  {
    id: 'web',
    label: 'ค้นหาและเว็บ',
    icon: '🔎',
    match: /search|web|browser|scrape|ค้นหา|เว็บ/i,
    search: 'search',
  },
  {
    id: 'work',
    label: 'งานและนัดหมาย',
    icon: '📅',
    match: /calendar|task|todo|schedule|plan|jira|linear|ปฏิทิน|นัด|งาน|วางแผน/i,
    search: 'calendar',
  },
  {
    id: 'device',
    label: 'อุปกรณ์และระบบ',
    icon: '📱',
    match: /device|\bpc\b|system|home|iot|อุปกรณ์|เครื่อง|คอม|มือถือ/i,
    search: 'home automation',
  },
  {
    id: 'media',
    label: 'สื่อและครีเอทีฟ',
    icon: '🎨',
    match: /image|video|audio|music|design|figma|รูป|วิดีโอ|เสียง/i,
    search: 'image',
  },
  {
    id: 'finance',
    label: 'การเงิน',
    icon: '💰',
    match: /finance|stock|crypto|payment|bank|เงิน|หุ้น/i,
    search: 'finance',
  },
];
export const OTHER_CATEGORY = { id: 'other', label: 'อื่น ๆ', icon: '✨' } as const;

export function categoryOf(text: string): string {
  return MARKET_CATEGORIES.find((c) => c.match.test(text))?.id ?? OTHER_CATEGORY.id;
}

const textOf = (e: MarketEntry) => [e.title, e.subtitle, ...e.details].join(' ');

/** รายการของแท็บ+ขอบเขต: ของคุณ = ติดตั้งแล้ว · สำรวจ = ทุกอย่างที่มีให้ (ทักษะแนะนำที่ยังไม่ติดตั้ง + ของในตัว) */
export function entriesFor(
  entries: readonly MarketEntry[],
  tab: MarketTab,
  scope: MarketScope,
  query: string,
  sort: MarketSort,
  category: string | null = null,
): MarketEntry[] {
  const kinds = MARKET_TABS.find((t) => t.id === tab)?.kinds ?? [];
  const q = query.trim().toLowerCase();
  const list = entries.filter(
    (e) =>
      kinds.includes(e.kind) &&
      (scope === 'mine' ? e.installed : tab === 'skill' ? !e.installed : true) &&
      (!category || categoryOf(textOf(e)) === category) &&
      (!q || textOf(e).toLowerCase().includes(q) || e.badge.toLowerCase().includes(q)),
  );
  return [...list].sort((a, b) =>
    sort === 'enabled' && a.enabled !== b.enabled
      ? a.enabled
        ? -1
        : 1
      : a.title.localeCompare(b.title, 'th'),
  );
}

/** หมวด + จำนวนของรายการในแท็บนั้น (หมวดที่ไม่มีของ = ไม่แสดง) */
export function categoryCounts(
  entries: readonly MarketEntry[],
): { id: string; label: string; icon: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries)
    counts.set(categoryOf(textOf(e)), (counts.get(categoryOf(textOf(e))) ?? 0) + 1);
  return [...MARKET_CATEGORIES, OTHER_CATEGORY]
    .map((c) => ({ id: c.id, label: c.label, icon: c.icon, count: counts.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);
}
