/**
 * @file HTTP client ของ Mark 55 (server Shared Memory บน PC ของบอส — Phase 4.5.4.1)
 *
 * Endpoint (prefix `/api/v1`):
 * - `POST /auth/pair`   `{ code, deviceName }` → `{ token, expiresAt }` (JWT 30 วัน · จำกัด 5 ครั้ง/นาที/IP)
 * - `GET  /auth/verify` (Bearer) → `{ valid, deviceName, expiresAt }`
 * - `GET  /memory/sync?since=<ms>` (Bearer) → `{ facts, serverTimestamp }`
 * - `POST /memory/sync` (Bearer) `{ version, lastSyncAt, facts }` → `{ applied, conflicts, serverTimestamp }`
 * - `GET  /health` → `{ status, version, uptime }`
 *
 * Wire fact: `{ target: 'global' | { persona: '1'..'4' }, key, value, updatedAt, deleted? }`
 *
 * - ทุกคำขอผ่าน `request()` ของ core/http → timeout (10s) + ProviderError + redaction เหมือน provider อื่น
 * - **ไม่ retry เอง** — SyncQueue เป็นคนตัดสินใจว่าจะลองใหม่เมื่อไร
 * - ข้อความ error เป็นไทยที่บอสทำตามได้ (`syncErrorText()` ตัด prefix `[mark55]` ออกสำหรับแสดงใน UI)
 * - อ่าน response แบบระวัง: fact ที่รูปแบบผิดถูกข้าม (log) ไม่ทำให้ sync ทั้งรอบล้ม
 *
 * ชื่อ field ของ request/response อิง wire format ใน spec 4.5.4.2 — ถ้า Mark 55 ใช้ชื่ออื่น
 * แก้ที่ `toWire()` / `fromWire()` / ตัว parse ในไฟล์นี้ที่เดียว
 */

import { ProviderError, type ProviderErrorKind } from '../http/errors';
import { request, requestJson } from '../http/request';
import { isArray, isBoolean, isNumber, isRecord, isString } from '../types/guards';
import { isPersona } from '../types/persona';
import { MEMORY_KEY_PATTERN, type MemoryTarget, type SyncFact } from './types';

export const MARK55_PROVIDER_ID = 'mark55';
/** เวอร์ชันรูปแบบข้อมูลที่ server ตรวจ (ตรงกับ prefix ของ LocalMemoryAdapter) */
export const SYNC_VERSION = 'atom.memory.v1';
export const REMOTE_TIMEOUT_MS = 10_000;

export interface RemoteMemoryConfig {
  /** เช่น `http://192.168.1.10:8787` (ไม่ต้องมี `/api/v1`) */
  baseUrl: string;
  /** JWT จาก `pair()` — ไม่มี = เรียกได้แค่ `pair()` กับ `health()` */
  token?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface PairResult {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

export interface VerifyResult {
  valid: boolean;
  deviceName: string | null;
  /** epoch ms */
  expiresAt: number | null;
}

export interface PullResult {
  facts: SyncFact[];
  /** เวลาของ server (epoch ms) — ใช้เป็น `since` รอบถัดไป เพื่อไม่พึ่งนาฬิกามือถือ */
  serverTimestamp: number;
}

export interface PushConflict {
  target: MemoryTarget;
  key: string;
  /** ฉบับที่ server เก็บไว้ (ชนะ) — null = server ไม่ได้ส่งมา */
  server: SyncFact | null;
}

export interface PushResult {
  applied: number;
  /** fact ที่ server ไม่รับ เพราะฉบับของ server ใหม่กว่า */
  conflicts: PushConflict[];
  serverTimestamp: number;
}

export interface HealthResult {
  status: string;
  version: string;
  /** วินาที */
  uptime: number;
}

/** ส่วนที่ SyncQueue ต้องใช้ — test ใส่ตัวปลอมได้ */
export interface SyncRemote {
  pull(since: number): Promise<PullResult>;
  push(facts: SyncFact[], lastSyncAt: number): Promise<PushResult>;
}

type Action = 'pair' | 'verify' | 'pull' | 'push' | 'health';

export class RemoteMemoryAdapter implements SyncRemote {
  private readonly baseUrl: string;
  private token: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: RemoteMemoryConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token || undefined;
    this.timeoutMs = config.timeoutMs ?? REMOTE_TIMEOUT_MS;
  }

  get isPaired(): boolean {
    return this.token !== undefined;
  }

  /** แลก pairing code 6 หลักเป็น token — สำเร็จแล้ว adapter นี้ใช้ token ใหม่ทันที (ผู้เรียกเก็บลง SecureStore เอง) */
  async pair(pairingCode: string, deviceName: string): Promise<PairResult> {
    const code = pairingCode.trim();
    if (!/^\d{6}$/.test(code)) {
      throw new ProviderError(MARK55_PROVIDER_ID, 'bad_request', 'รหัสจับคู่ต้องเป็นตัวเลข 6 หลัก');
    }
    const body = await this.call('pair', 'POST', '/auth/pair', { code, deviceName }, false);
    const token = isRecord(body) && isString(body.token) && body.token ? body.token : null;
    const expiresAt = isRecord(body) ? toEpoch(body.expiresAt) : null;
    if (!token || expiresAt === null) throw invalid('pair');
    this.token = token;
    return { token, expiresAt };
  }

  /** token ยังใช้ได้ไหม — 401/403 คืน `valid: false` (ไม่ throw) · ออฟไลน์/ล่ม → throw */
  async verify(): Promise<VerifyResult> {
    try {
      const body = await this.call('verify', 'GET', '/auth/verify');
      if (!isRecord(body)) throw invalid('verify');
      return {
        valid: body.valid !== false,
        deviceName: isString(body.deviceName) ? body.deviceName : null,
        expiresAt: toEpoch(body.expiresAt),
      };
    } catch (e) {
      if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'missing_key')) {
        return { valid: false, deviceName: null, expiresAt: null };
      }
      // Mark 55 ที่ไม่มี /auth/verify (404) → ลอง pull เปล่า ๆ แทน: ผ่าน = token ใช้ได้ (ไม่รู้ชื่อ/วันหมดอายุ)
      if (e instanceof ProviderError && e.status === 404) return this.verifyByPull();
      throw e;
    }
  }

  private async verifyByPull(): Promise<VerifyResult> {
    try {
      await this.pull(Date.now());
      return { valid: true, deviceName: null, expiresAt: null };
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'auth') return { valid: false, deviceName: null, expiresAt: null };
      throw e;
    }
  }

  /** การเปลี่ยนแปลงบน server หลัง `since` (รวม tombstone) */
  async pull(since: number): Promise<PullResult> {
    const body = await this.call('pull', 'GET', `/memory/sync?since=${Math.max(0, Math.floor(since))}`);
    const serverTimestamp = isRecord(body) ? serverTimeOf(body) : null;
    if (!isRecord(body) || !isArray(body.facts) || serverTimestamp === null) throw invalid('pull');
    return { facts: parseFacts(body.facts), serverTimestamp };
  }

  async push(facts: SyncFact[], lastSyncAt: number): Promise<PushResult> {
    const body = await this.call('push', 'POST', '/memory/sync', {
      version: SYNC_VERSION,
      lastSyncAt,
      facts: facts.map(toWire),
    });
    const serverTimestamp = isRecord(body) ? serverTimeOf(body) : null;
    if (!isRecord(body) || serverTimestamp === null) throw invalid('push');
    // server บางรุ่นตอบรายการ fact ที่รับแทนจำนวน — นับให้
    const applied = isNumber(body.applied) ? body.applied : isArray(body.applied) ? body.applied.length : 0;
    const conflicts = isArray(body.conflicts) ? body.conflicts.flatMap(parseConflict) : [];
    return { applied, conflicts, serverTimestamp };
  }

  /** ไม่ต้องใช้ token — ใช้ตรวจว่า URL ถูกและ server เปิดอยู่ */
  async health(): Promise<HealthResult> {
    const body = await this.call('health', 'GET', '/health', undefined, false);
    if (!isRecord(body) || !isString(body.status)) throw invalid('health');
    return {
      status: body.status,
      version: isString(body.version) ? body.version : '',
      uptime: isNumber(body.uptime) ? body.uptime : 0,
    };
  }

  // ---- internals ------------------------------------------------------------------------------

  private async call(
    action: Action,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    auth = true
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      if (!this.token) throw remoteError(action, 'missing_key');
      headers.Authorization = `Bearer ${this.token}`;
    }
    const url = `${this.baseUrl}/api/v1${path}`;
    const init = {
      method,
      headers,
      timeoutMs: this.timeoutMs,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    try {
      if (method === 'POST' && action === 'push') {
        // push อาจตอบ 204 ได้ถ้าไม่มีอะไรให้คืน — อ่าน body เองแทน requestJson
        const res = await request(MARK55_PROVIDER_ID, url, init);
        const text = await res.text();
        return text ? parseBody(action, text) : {};
      }
      return await requestJson<unknown>(MARK55_PROVIDER_ID, url, init);
    } catch (e) {
      if (e instanceof ProviderError) throw remoteError(action, e.kind, e.status, e.message);
      throw e;
    }
  }
}

// ---- wire format ------------------------------------------------------------------------------

interface WireFact {
  target: 'global' | { persona: string };
  key: string;
  value: string;
  updatedAt: number;
  deleted?: boolean;
}

export function toWire(fact: SyncFact): WireFact {
  return {
    target: fact.target.scope === 'global' ? 'global' : { persona: String(fact.target.persona) },
    key: fact.key,
    value: fact.deleted ? '' : fact.value,
    updatedAt: fact.updatedAt,
    ...(fact.deleted ? { deleted: true } : {}),
  };
}

function targetFromWire(v: unknown): MemoryTarget | null {
  if (v === 'global') return { scope: 'global' };
  if (!isRecord(v)) return null;
  // server ส่ง persona เป็น string '1'..'4' — รับ number ด้วยเผื่อ
  const persona = isString(v.persona) ? Number(v.persona) : v.persona;
  return isPersona(persona) ? { scope: 'persona', persona } : null;
}

export function fromWire(v: unknown): SyncFact | null {
  if (!isRecord(v)) return null;
  const target = targetFromWire(v.target);
  const updatedAt = toEpoch(v.updatedAt);
  const deleted = isBoolean(v.deleted) ? v.deleted : false;
  if (!target || !isString(v.key) || !MEMORY_KEY_PATTERN.test(v.key) || updatedAt === null) return null;
  if (!deleted && !isString(v.value)) return null;
  return { target, key: v.key, value: isString(v.value) ? v.value : '', updatedAt, deleted };
}

function parseFacts(list: unknown[]): SyncFact[] {
  const facts = list.map(fromWire).filter((f): f is SyncFact => f !== null);
  if (facts.length < list.length) {
    console.error(`[memory:remote] ข้าม fact ที่รูปแบบไม่ถูกต้อง ${list.length - facts.length} รายการ`);
  }
  return facts;
}

/** `{ target, key, server|serverFact }` หรือ wire fact ฉบับของ server ตรง ๆ */
function parseConflict(v: unknown): PushConflict[] {
  if (!isRecord(v)) return [];
  const server = fromWire(v.server ?? v.serverFact ?? v);
  const target = targetFromWire(v.target) ?? server?.target ?? null;
  const key = isString(v.key) ? v.key : server?.key;
  return target && key ? [{ target, key, server }] : [];
}

/** epoch ms จาก number หรือ ISO string */
function toEpoch(v: unknown): number | null {
  if (isNumber(v)) return v;
  if (isString(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function serverTimeOf(body: Record<string, unknown>): number | null {
  return toEpoch(body.serverTimestamp) ?? toEpoch(body.syncedAt);
}

function parseBody(action: Action, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(action);
  }
}

// ---- errors -----------------------------------------------------------------------------------

const PAIR_TEXT: Partial<Record<ProviderErrorKind, string>> = {
  auth: 'รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ — ขอรหัสใหม่จาก Mark 55 แล้วลองอีกครั้ง',
  rate_limit: 'ลองจับคู่ถี่เกินไป (จำกัด 5 ครั้งต่อนาที) — รอ 1 นาทีแล้วลองใหม่',
};

const TEXT: Record<ProviderErrorKind, string> = {
  auth: 'การจับคู่หมดอายุหรือถูกยกเลิก — จับคู่ใหม่ที่ ตั้งค่า › Sync',
  missing_key: 'ยังไม่ได้จับคู่กับ Mark 55 — ใส่รหัสจับคู่ที่ ตั้งค่า › Sync',
  rate_limit: 'เรียก Mark 55 ถี่เกินไป — รอสักครู่แล้วลองใหม่',
  server: 'Mark 55 ขัดข้อง — ดู log ที่ server แล้วลองใหม่',
  timeout: `Mark 55 ไม่ตอบภายใน ${REMOTE_TIMEOUT_MS / 1000} วินาที — ตรวจว่า server เปิดอยู่`,
  network: 'เชื่อมต่อ Mark 55 ไม่ได้ — ตรวจว่า server เปิดอยู่ และมือถืออยู่ Wi-Fi เดียวกับ PC',
  bad_request: 'Mark 55 ไม่รับคำขอนี้',
  invalid_response: 'Mark 55 ตอบกลับในรูปแบบที่อ่านไม่ได้ — ตรวจว่า URL ชี้ไปที่ Mark 55 และเวอร์ชันตรงกัน',
  unsupported: 'Mark 55 รุ่นนี้ยังไม่รองรับคำสั่งนี้',
  permission: 'ไม่ได้รับอนุญาตให้เชื่อมต่อเครือข่าย',
};

function remoteError(action: Action, kind: ProviderErrorKind, status?: number, detail?: string): ProviderError {
  let text = (action === 'pair' ? PAIR_TEXT[kind] : undefined) ?? TEXT[kind];
  // 4xx อื่น ๆ: รายละเอียดจาก server (ผ่าน redactSecrets ใน request() แล้ว) ช่วยบอกว่าผิดตรงไหน
  if (kind === 'bad_request' && detail) text += ` (${detail.replace(/^\[mark55\] /, '')})`;
  else if (status !== undefined && kind === 'server') text += ` (HTTP ${status})`;
  return new ProviderError(MARK55_PROVIDER_ID, kind, text, status);
}

const invalid = (action: Action) => remoteError(action, 'invalid_response');

/** ข้อความสำหรับ UI: ไม่มี prefix `[mark55]` */
export function syncErrorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^\[mark55\] /, '');
}

// ---- server URL -------------------------------------------------------------------------------

const URL_PATTERN = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i;

/**
 * http ใช้ได้เฉพาะเครือข่ายในบ้าน (Mark 55 รันบน PC — ไม่มี TLS) · ที่อยู่สาธารณะต้อง https
 * เพราะ token ถูกส่งไปทุกคำขอ · 100.64/10 = Tailscale
 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan')) return true;
  const ip = h.split('.').map(Number);
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a = -1, b = -1] = ip;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** ตรวจ + จัดรูป Server URL ที่บอสพิมพ์ (ตัด `/` และ `/api/v1` ท้าย, ไม่มี scheme → `http://`) */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
  let url = input.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  if (!url) return { error: 'ใส่ Server URL ก่อน เช่น http://192.168.1.10:8787' };
  if (!/^[a-z]+:\/\//i.test(url)) url = `http://${url}`;
  const m = URL_PATTERN.exec(url);
  if (!m) return { error: 'Server URL ไม่ถูกต้อง — รูปแบบ http://<IP ของ PC>:8787' };
  const [, scheme = '', host = '', port] = m;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return { error: 'พอร์ตต้องอยู่ระหว่าง 1–65535' };
  }
  if (scheme.toLowerCase() === 'http' && !isPrivateHost(host)) {
    return { error: 'ที่อยู่นอกเครือข่ายบ้านต้องใช้ https:// เพื่อไม่ให้ token รั่ว' };
  }
  return { url: `${scheme.toLowerCase()}://${host.toLowerCase()}${port !== undefined ? `:${port}` : ''}` };
}
