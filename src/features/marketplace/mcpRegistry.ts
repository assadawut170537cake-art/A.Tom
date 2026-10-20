/**
 * @file คลัง MCP ทางการ (registry.modelcontextprotocol.io) สำหรับหน้า "สำรวจ › ตัวเชื่อมต่อ" (Boss ขอ · ADR-021)
 *
 * เอาเฉพาะ server ที่มี remote แบบ `streamable-http` — มือถือรัน server แบบ stdio (npm/pip) เองไม่ได้
 * ค้นทีละหน้า (cursor) ตามคำค้น/หมวด · ไม่ cache ข้ามครั้งเปิดหน้า (คลังเปลี่ยนบ่อย)
 * ⚠️ รูปแบบ response อิง API `v0` — เปลี่ยนแก้ที่ `parseRegistryPage()` ที่เดียว
 */

import { requestJson } from '../../core/http/request';
import { isArray, isRecord, isString } from '../../core/types/guards';

export const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE_SIZE = 100;

export interface RegistryServer {
  /** ชื่อเต็มในคลัง เช่น `io.github.foo/bar` — ใช้กันซ้ำ */
  name: string;
  title: string;
  description: string;
  url: string;
  /** remote ประกาศ header ที่ต้องมี (เช่น Authorization) → ต้องใส่ token ก่อนเพิ่ม */
  needsToken: boolean;
}

export interface RegistryPage {
  servers: RegistryServer[];
  nextCursor: string | null;
}

export type RegistrySearch = (query: string, cursor?: string | null) => Promise<RegistryPage>;

export function parseRegistryPage(body: unknown): RegistryPage {
  if (!isRecord(body) || !isArray(body.servers)) return { servers: [], nextCursor: null };
  const seen = new Set<string>();
  const servers = body.servers.flatMap((item): RegistryServer[] => {
    const s = isRecord(item) && isRecord(item.server) ? item.server : null;
    if (!s || !isString(s.name) || seen.has(s.name) || !isArray(s.remotes)) return [];
    const remote = s.remotes.find(
      (r) => isRecord(r) && r.type === 'streamable-http' && isString(r.url),
    );
    if (!isRecord(remote) || !isString(remote.url)) return [];
    seen.add(s.name);
    const headers = isArray(remote.headers) ? remote.headers : [];
    return [
      {
        name: s.name,
        title: isString(s.title) && s.title ? s.title : s.name.split('/').pop() || s.name,
        description: isString(s.description) ? s.description : '',
        url: remote.url,
        needsToken: headers.some(
          (h) => isRecord(h) && (h.isRequired === true || h.name === 'Authorization'),
        ),
      },
    ];
  });
  const meta = isRecord(body.metadata) ? body.metadata : {};
  return { servers, nextCursor: isString(meta.nextCursor) ? meta.nextCursor : null };
}

export const searchMcpRegistry: RegistrySearch = async (query, cursor) => {
  const params = [`limit=${PAGE_SIZE}`, 'version=latest'];
  if (query.trim()) params.push(`search=${encodeURIComponent(query.trim())}`);
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  const body = await requestJson<unknown>(
    'mcp-registry',
    `${MCP_REGISTRY_URL}?${params.join('&')}`,
    {
      timeoutMs: 15_000,
    },
  );
  return parseRegistryPage(body);
};

/** id สำหรับ MCPClientBridge (a-z 0-9 _ - ≤ 32) จากชื่อในคลัง · ชนกับที่มีอยู่ → ต่อท้าย -2, -3 */
export function registryServerId(name: string, taken: readonly string[]): string {
  const base =
    (name.split('/').pop() ?? name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'mcp';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
