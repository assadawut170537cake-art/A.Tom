/**
 * รวม MCP servers / Plugins (module) / Skills / Device Control เป็นรายการเดียวสำหรับหน้า Marketplace
 * แยกจาก UI เพื่อให้ test ได้ตรง ๆ
 */

import { deviceControl, type DeviceControlBridge } from '../../core/agent/DeviceControlBridge';
import { mcpBridge, type MCPClientBridge } from '../../core/agent/MCPClientBridge';
import { skillEngine, type SkillEngine } from '../../core/agent/SkillEngine';
import { moduleManager, type ModuleManager } from '../../core/modules/ModuleManager';

export type MarketKind = 'mcp' | 'plugin' | 'skill' | 'device';
export type MarketFilter = 'all' | MarketKind;

export const MARKET_FILTERS: { id: MarketFilter; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'skill', label: 'Skills' },
  { id: 'device', label: 'อุปกรณ์' },
];

export interface MarketEntry {
  key: string;
  kind: MarketKind;
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  /** false = ยังไม่ติดตั้ง (ทักษะแนะนำ) → แสดงปุ่มติดตั้งแทนสวิตช์ */
  installed: boolean;
  enabled: boolean;
  status?: string | undefined;
  /** tools / คำสั่ง / ขั้นตอน ที่แสดงในรายละเอียด */
  details: string[];
  removable: boolean;
}

export interface MarketplaceDeps {
  mcp: Pick<MCPClientBridge, 'listServers' | 'setEnabled' | 'removeServer' | 'addServer' | 'connectAll'>;
  skills: Pick<SkillEngine, 'list' | 'catalog' | 'install' | 'setEnabled' | 'remove'>;
  device: Pick<DeviceControlBridge, 'isEnabled' | 'setEnabled' | 'capabilities'>;
  modules: Pick<ModuleManager, 'getSnapshot' | 'enable' | 'disable'>;
}

export const DEFAULT_MARKETPLACE_DEPS: MarketplaceDeps = {
  mcp: mcpBridge,
  skills: skillEngine,
  device: deviceControl,
  modules: moduleManager,
};

const MCP_STATUS = { connected: 'เชื่อมต่อแล้ว', disconnected: 'ยังไม่เชื่อมต่อ', error: 'เชื่อมต่อไม่ได้' } as const;

export async function loadEntries(deps: MarketplaceDeps): Promise<MarketEntry[]> {
  const [servers, skills, catalog, deviceOn] = await Promise.all([
    deps.mcp.listServers(),
    deps.skills.list(),
    deps.skills.catalog(),
    deps.device.isEnabled(),
  ]);
  const mcp = servers.map(({ config, status, error, tools, prompts, resources }): MarketEntry => ({
    key: `mcp:${config.id}`,
    kind: 'mcp',
    id: config.id,
    title: config.name,
    subtitle: config.url,
    badge: 'MCP',
    installed: true,
    enabled: config.enabled,
    status: error ? `${MCP_STATUS[status]}: ${error}` : MCP_STATUS[status],
    details: [
      ...tools.map((t) => `🔧 ${t.name}${t.description ? ` — ${t.description}` : ''}`),
      ...(prompts.length ? [`💬 prompts ${prompts.length} รายการ`] : []),
      ...(resources.length ? [`📄 resources ${resources.length} รายการ`] : []),
    ],
    removable: true,
  }));
  const plugins = deps.modules.getSnapshot().map((m): MarketEntry => ({
    key: `plugin:${m.id}`,
    kind: 'plugin',
    id: m.id,
    title: m.name,
    subtitle: m.description ?? m.id,
    badge: 'Plugin',
    installed: true,
    enabled: m.enabled,
    status: m.status,
    details: m.dependencies.length ? [`ต้องใช้: ${m.dependencies.join(', ')}`] : [],
    removable: false,
  }));
  const installed = skills.map((s): MarketEntry => ({
    key: `skill:${s.id}`,
    kind: 'skill',
    id: s.id,
    title: s.name,
    subtitle: s.description,
    badge: s.origin === 'learned' ? 'AI สร้าง' : 'ทักษะ',
    installed: true,
    enabled: s.enabled,
    status: s.origin === 'learned' && !s.enabled ? 'รอบอสตรวจและเปิดใช้' : `ใช้แล้ว ${s.uses} ครั้ง`,
    details: [s.instructions],
    removable: true,
  }));
  const suggested = catalog.map((c): MarketEntry => ({
    key: `skill:${c.id}`,
    kind: 'skill',
    id: c.id,
    title: c.name,
    subtitle: c.description,
    badge: 'แนะนำ',
    installed: false,
    enabled: false,
    details: [c.instructions],
    removable: false,
  }));
  const device: MarketEntry = {
    key: 'device',
    kind: 'device',
    id: 'device',
    title: 'ควบคุมอุปกรณ์',
    subtitle: 'ให้ผู้ช่วยปรับเสียง ความสว่าง เปิดแอป ฯลฯ (ปิดไว้เป็นค่าเริ่มต้น)',
    badge: 'อุปกรณ์',
    installed: true,
    enabled: deviceOn,
    details: deps.device.capabilities().map((c) => `${c.supported ? '✅' : '⛔ ยังไม่รองรับ —'} ${c.name}: ${c.description}`),
    removable: false,
  };
  return [...mcp, ...plugins, ...installed, ...suggested, device];
}

export function filterEntries(entries: readonly MarketEntry[], filter: MarketFilter, query: string): MarketEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (filter === 'all' || e.kind === filter) &&
      (!q || [e.title, e.subtitle, e.badge, ...e.details].some((t) => t.toLowerCase().includes(q)))
  );
}

/** เปิด/ปิดตามชนิด · คืนข้อความ error ภาษาไทย หรือ null */
export async function setEntryEnabled(deps: MarketplaceDeps, entry: MarketEntry, on: boolean): Promise<string | null> {
  switch (entry.kind) {
    case 'mcp': {
      const state = await deps.mcp.setEnabled(entry.id, on);
      return on && state?.status === 'error' ? `เปิดแล้ว แต่${MCP_STATUS.error}: ${state.error ?? ''}` : null;
    }
    case 'plugin': {
      const result = on ? await deps.modules.enable(entry.id) : await deps.modules.disable(entry.id);
      return 'error' in result && result.error ? `เปิดแล้ว แต่เริ่มทำงานไม่สำเร็จ: ${result.error}` : null;
    }
    case 'skill':
      await deps.skills.setEnabled(entry.id, on);
      return null;
    case 'device':
      await deps.device.setEnabled(on);
      return null;
  }
}

export async function removeEntry(deps: MarketplaceDeps, entry: MarketEntry): Promise<void> {
  if (entry.kind === 'mcp') await deps.mcp.removeServer(entry.id);
  else if (entry.kind === 'skill') await deps.skills.remove(entry.id);
}
