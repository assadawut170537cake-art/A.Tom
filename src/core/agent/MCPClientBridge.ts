/**
 * @file MCP (Model Context Protocol) client — ดึง Tools / Prompts / Resources จาก MCP server ภายนอกให้ agent ใช้
 *
 * - Transport: **Streamable HTTP** (JSON-RPC 2.0 ผ่าน `fetch` POST) — ไม่เพิ่ม dependency
 *   ตอบได้ทั้ง `application/json` และ `text/event-stream` (อ่าน `data:` ที่มี id ตรงกับคำขอ)
 * - ขั้นตอน: `initialize` → `notifications/initialized` → `tools/list` / `prompts/list` / `resources/list`
 *   เก็บ `Mcp-Session-Id` ที่ server ส่งมาแล้วแนบทุกคำขอถัดไป
 * - รายการ server (ไม่ลับ) → AsyncStorage `atom.mcp.v1.servers` · token → SecureStore `mcp.<id>` เท่านั้น
 * - tool ของ server ชื่อ `mcp.<serverId>.<toolName>` ในมุมของ agent · error ทุกชนิดผ่าน `redactSecrets()`
 * - server ที่เพิ่มใหม่ **ปิดไว้ก่อน** — บอสต้องเปิดเองในหน้า Marketplace (ข้อความจากภายนอกเข้า prompt ได้)
 */

import { redactSecrets } from '../http/errors';
import { toPromptLine } from '../memory/promptLine';
import { readJSON, writeJSON } from '../storage/jsonStorage';
import { SecureKeyStore } from '../storage/SecureKeyStore';
import { isArray, isBoolean, isRecord, isString } from '../types/guards';
import type { AgentToolCall, AgentToolProvider, AgentToolResult, AgentToolSpec } from './types';

export const MCP_SERVERS_KEY = 'atom.mcp.v1.servers';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_TIMEOUT_MS = 15_000;
/** id ของ server ใช้เป็นส่วนหนึ่งของ tool id และชื่อ key ใน SecureStore */
export const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface MCPToolInfo {
  name: string;
  description?: string | undefined;
}

export interface MCPNamedItem {
  name: string;
  description?: string | undefined;
}

export interface MCPServerState {
  config: MCPServerConfig;
  status: 'disconnected' | 'connected' | 'error';
  error?: string | undefined;
  tools: MCPToolInfo[];
  prompts: MCPNamedItem[];
  resources: MCPNamedItem[];
}

const mcpSecretKey = (id: string) => `mcp.${id}`;
export const mcpToolId = (serverId: string, tool: string) => `mcp.${serverId}.${tool}`;

const isServerConfig = (v: unknown): v is MCPServerConfig =>
  isRecord(v) &&
  isString(v.id) &&
  MCP_SERVER_ID_PATTERN.test(v.id) &&
  isString(v.name) &&
  isString(v.url) &&
  isBoolean(v.enabled);

/** ตรวจ URL: https เท่านั้น (ยกเว้น localhost สำหรับทดสอบ) */
export function validateServerUrl(url: string): string | null {
  if (!/^https:\/\/[^\s/]+/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)) {
    return 'URL ต้องขึ้นต้นด้วย https:// (หรือ http://localhost สำหรับทดสอบ)';
  }
  return null;
}

class MCPError extends Error {}

const errorText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e));

/** อ่าน JSON-RPC response จาก body ที่อาจเป็น JSON หรือ SSE */
export function parseRpcBody(body: string, contentType: string, id: number): unknown {
  if (contentType.includes('text/event-stream')) {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const msg: unknown = JSON.parse(line.slice(5).trim());
        if (isRecord(msg) && msg.id === id) return msg;
      } catch {
        // event อื่นที่ไม่ใช่ JSON (เช่น ping) — ข้าม
      }
    }
    throw new MCPError('ไม่พบคำตอบใน event stream');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new MCPError('คำตอบไม่ใช่ JSON');
  }
}

const namedItems = (list: unknown): MCPNamedItem[] =>
  isArray(list)
    ? list.flatMap((item) =>
        isRecord(item) && isString(item.name)
          ? [{ name: item.name, description: isString(item.description) ? item.description : undefined }]
          : []
      )
    : [];

export class MCPClientBridge implements AgentToolProvider {
  private servers: MCPServerConfig[] = [];
  private loaded: Promise<void> | null = null;
  private readonly states = new Map<string, MCPServerState>();
  private readonly sessions = new Map<string, string>();
  private nextId = 1;

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  // ---- server list ------------------------------------------------------------------------------

  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const raw = await readJSON(MCP_SERVERS_KEY, isArray);
        this.servers = (raw ?? []).filter(isServerConfig);
      } catch (e) {
        console.error('[mcp] อ่านรายการ MCP server ไม่ได้', e);
        this.servers = [];
      }
    })());
  }

  async listServers(): Promise<MCPServerState[]> {
    await this.load();
    return this.servers.map((config) => this.stateOf(config));
  }

  /** เพิ่ม server (ปิดไว้ก่อน) · คืนข้อความ error ภาษาไทย หรือ null เมื่อสำเร็จ */
  async addServer(input: { id: string; name: string; url: string; token?: string | undefined }): Promise<string | null> {
    await this.load();
    const id = input.id.trim().toLowerCase();
    const url = input.url.trim();
    if (!MCP_SERVER_ID_PATTERN.test(id)) return 'รหัส server ใช้ได้เฉพาะ a-z 0-9 _ - (ไม่เกิน 32 ตัว)';
    if (this.servers.some((s) => s.id === id)) return `มี server "${id}" อยู่แล้ว`;
    const urlError = validateServerUrl(url);
    if (urlError) return urlError;
    const config: MCPServerConfig = { id, name: input.name.trim() || id, url, enabled: false };
    try {
      if (input.token?.trim()) await SecureKeyStore.set(mcpSecretKey(id), input.token.trim());
      this.servers = [...this.servers, config];
      await writeJSON(MCP_SERVERS_KEY, this.servers);
      return null;
    } catch (e) {
      console.error('[mcp] บันทึก MCP server ไม่ได้', e);
      return 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง';
    }
  }

  async removeServer(id: string): Promise<void> {
    await this.load();
    this.servers = this.servers.filter((s) => s.id !== id);
    this.states.delete(id);
    this.sessions.delete(id);
    await SecureKeyStore.delete(mcpSecretKey(id));
    await writeJSON(MCP_SERVERS_KEY, this.servers);
  }

  /** เปิด → เชื่อมต่อและดึงรายการ tool ทันที · ปิด → ตัดออกจาก agent */
  async setEnabled(id: string, enabled: boolean): Promise<MCPServerState | undefined> {
    await this.load();
    const config = this.servers.find((s) => s.id === id);
    if (!config) return undefined;
    config.enabled = enabled;
    await writeJSON(MCP_SERVERS_KEY, this.servers);
    if (!enabled) {
      this.states.delete(id);
      this.sessions.delete(id);
      return this.stateOf(config);
    }
    return this.refresh(id);
  }

  /** เชื่อมต่อทุก server ที่เปิดอยู่ (เช่นตอนเปิดหน้า Marketplace หรือก่อนรัน agent) */
  async connectAll(): Promise<MCPServerState[]> {
    await this.load();
    const states = await Promise.all(this.servers.filter((s) => s.enabled).map((s) => this.refresh(s.id)));
    return states.filter((s): s is MCPServerState => s !== undefined);
  }

  /** initialize + ดึง tools / prompts / resources — ล้มแล้ว status = error (ไม่ throw) */
  async refresh(id: string): Promise<MCPServerState | undefined> {
    await this.load();
    const config = this.servers.find((s) => s.id === id);
    if (!config) return undefined;
    try {
      await this.initialize(config);
      const tools = await this.rpc(config, 'tools/list', {});
      const prompts = await this.rpc(config, 'prompts/list', {}).catch(() => ({}));
      const resources = await this.rpc(config, 'resources/list', {}).catch(() => ({}));
      const state: MCPServerState = {
        config,
        status: 'connected',
        tools: namedItems(isRecord(tools) ? tools.tools : undefined),
        prompts: namedItems(isRecord(prompts) ? prompts.prompts : undefined),
        resources: namedItems(isRecord(resources) ? resources.resources : undefined),
      };
      this.states.set(id, state);
      return state;
    } catch (e) {
      const state: MCPServerState = { config, status: 'error', error: errorText(e), tools: [], prompts: [], resources: [] };
      this.states.set(id, state);
      return state;
    }
  }

  // ---- AgentToolProvider ------------------------------------------------------------------------

  listTools(): AgentToolSpec[] {
    return this.servers
      .filter((s) => s.enabled)
      .flatMap((s) =>
        (this.states.get(s.id)?.tools ?? []).map((t) => ({
          id: mcpToolId(s.id, t.name),
          name: `${s.name}: ${t.name}`,
          description: t.description,
          source: 'mcp' as const,
        }))
      );
  }

  async call(call: AgentToolCall): Promise<AgentToolResult> {
    const server = this.servers.find((s) => s.enabled && call.tool.startsWith(`mcp.${s.id}.`));
    if (!server) return { ok: false, output: `ไม่พบ MCP tool "${call.tool}"` };
    const name = call.tool.slice(`mcp.${server.id}.`.length);
    try {
      const result = await this.rpc(server, 'tools/call', { name, arguments: call.args ?? { text: call.text } });
      const content = isRecord(result) && isArray(result.content) ? result.content : [];
      const text = content
        .flatMap((c) => (isRecord(c) && c.type === 'text' && isString(c.text) ? [c.text] : []))
        .join('\n');
      const isError = isRecord(result) && result.isError === true;
      return { ok: !isError, output: toPromptLine(redactSecrets(text || '(ไม่มีข้อความตอบกลับ)'), 2_000) };
    } catch (e) {
      return { ok: false, output: `MCP "${server.name}" ล้มเหลว: ${errorText(e)}` };
    }
  }

  // ---- JSON-RPC ---------------------------------------------------------------------------------

  private stateOf(config: MCPServerConfig): MCPServerState {
    return this.states.get(config.id) ?? { config, status: 'disconnected', tools: [], prompts: [], resources: [] };
  }

  private async initialize(config: MCPServerConfig): Promise<void> {
    this.sessions.delete(config.id);
    await this.rpc(config, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'atom', version: '1.0.0' },
    });
    await this.send(config, { jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  private async rpc(config: MCPServerConfig, method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.send(config, { jsonrpc: '2.0', id, method, params });
    const msg = parseRpcBody(await res.text(), res.headers.get('content-type') ?? '', id);
    if (!isRecord(msg)) throw new MCPError('คำตอบผิดรูปแบบ');
    if (isRecord(msg.error)) {
      throw new MCPError(`${method}: ${isString(msg.error.message) ? msg.error.message : 'error'}`);
    }
    return msg.result;
  }

  private async send(config: MCPServerConfig, body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    const token = await SecureKeyStore.get(mcpSecretKey(config.id));
    if (token) headers.Authorization = `Bearer ${token}`;
    const session = this.sessions.get(config.id);
    if (session) headers['Mcp-Session-Id'] = session;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const newSession = res.headers.get('mcp-session-id');
      if (newSession) this.sessions.set(config.id, newSession);
      if (!res.ok) {
        throw new MCPError(
          res.status === 401 || res.status === 403
            ? `HTTP ${res.status}: token ไม่ถูกต้องหรือไม่มีสิทธิ์`
            : `HTTP ${res.status}: เชื่อมต่อ server ไม่ได้`
        );
      }
      return res;
    } catch (e) {
      if (e instanceof MCPError) throw e;
      throw new MCPError(controller.signal.aborted ? 'หมดเวลารอ server' : `เชื่อมต่อไม่ได้ (${errorText(e)})`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** ตัวเดียวทั้งแอป — agent และหน้า Marketplace ใช้ร่วมกัน */
export const mcpBridge = new MCPClientBridge();
