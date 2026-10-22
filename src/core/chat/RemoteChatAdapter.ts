/**
 * @file HTTP client ของ "ห้องแชทเดียวกัน" บน Mark 55 — ส่ง/ดึงข้อความแชทข้ามเครื่อง (ADR-015)
 *
 * ใช้ Mark 55 ตัวเดียวกับ Shared Memory (baseUrl + token จาก `memorySync`) คนละ endpoint:
 * - `GET  /chat/sync?since=<ms>` (Bearer) → `{ messages, serverTimestamp }`
 * - `POST /chat/sync` (Bearer) `{ version, messages }` → `{ applied, serverTimestamp }`
 *
 * Wire message: `{ id, persona: '1'..'4', role: 'user'|'assistant', content, createdAt }`
 *
 * - ผ่าน `request()` ของ core/http → timeout 10s + ProviderError + redaction เหมือน provider อื่น
 * - **ไม่ retry เอง** — `ChatSync` ตัดสินใจลองใหม่ (เหมือน RemoteMemoryAdapter กับ SyncQueue)
 * - append-only: push ส่งเฉพาะข้อความใหม่ · pull คืนทุกข้อความหลัง `since` · ข้อความรูปแบบผิดถูกข้าม (log)
 * - ชื่อ field อิง wire format เดียวกับ memory — Mark 55 ใช้ชื่ออื่น แก้ที่ไฟล์นี้ที่เดียว
 */

import { ProviderError, type ProviderErrorKind } from '../http/errors';
import { request, requestJson } from '../http/request';
import { isArray, isNumber, isRecord } from '../types/guards';
import {
  CHAT_SYNC_VERSION,
  parseSyncMessage,
  toWireMessage,
  type SyncMessage,
} from './chatSyncTypes';

export const CHAT_PROVIDER_ID = 'mark55';
export const CHAT_TIMEOUT_MS = 10_000;

export interface RemoteChatConfig {
  /** เช่น `http://192.168.1.10:8787` (ไม่ต้องมี `/api/v1`) */
  baseUrl: string;
  token: string;
  timeoutMs?: number | undefined;
}

export interface ChatPullResult {
  messages: SyncMessage[];
  /** เวลาของ server (epoch ms) — ใช้เป็น `since` รอบถัดไป ไม่พึ่งนาฬิกามือถือ */
  serverTimestamp: number;
}

export interface ChatPushResult {
  applied: number;
  serverTimestamp: number;
}

/** ส่วนที่ ChatSync ใช้ — test ใส่ตัวปลอมได้ */
export interface ChatRemote {
  pull(since: number): Promise<ChatPullResult>;
  push(messages: SyncMessage[]): Promise<ChatPushResult>;
}

type Action = 'pull' | 'push';

export class RemoteChatAdapter implements ChatRemote {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: RemoteChatConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? CHAT_TIMEOUT_MS;
  }

  async pull(since: number): Promise<ChatPullResult> {
    const body = await this.call(
      'pull',
      'GET',
      `/chat/sync?since=${Math.max(0, Math.floor(since))}`,
    );
    const serverTimestamp = isRecord(body) ? serverTimeOf(body) : null;
    if (!isRecord(body) || !isArray(body.messages) || serverTimestamp === null)
      throw invalid('pull');
    return { messages: body.messages.flatMap((m) => parseSyncMessage(m) ?? []), serverTimestamp };
  }

  async push(messages: SyncMessage[]): Promise<ChatPushResult> {
    const body = await this.call('push', 'POST', '/chat/sync', {
      version: CHAT_SYNC_VERSION,
      messages: messages.map(toWireMessage),
    });
    const serverTimestamp = isRecord(body) ? serverTimeOf(body) : null;
    if (!isRecord(body) || serverTimestamp === null) throw invalid('push');
    const applied = isNumber(body.applied)
      ? body.applied
      : isArray(body.applied)
        ? body.applied.length
        : 0;
    return { applied, serverTimestamp };
  }

  private async call(
    action: Action,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const url = `${this.baseUrl}/api/v1${path}`;
    const init = {
      method,
      headers,
      timeoutMs: this.timeoutMs,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    try {
      if (method === 'POST') {
        // push อาจตอบ 204 — อ่าน body เองแทน requestJson
        const res = await request(CHAT_PROVIDER_ID, url, init);
        const text = await res.text();
        return text ? JSON.parse(text) : {};
      }
      return await requestJson<unknown>(CHAT_PROVIDER_ID, url, init);
    } catch (e) {
      if (e instanceof ProviderError) {
        throw new ProviderError(CHAT_PROVIDER_ID, e.kind, `[${action}] ${e.message}`, e.status);
      }
      if (e instanceof SyntaxError) throw invalid(action);
      throw e;
    }
  }
}

/** server อาจใช้ `serverTimestamp` หรือ `serverTime` — รับทั้งคู่ */
function serverTimeOf(body: Record<string, unknown>): number | null {
  const value = body.serverTimestamp ?? body.serverTime;
  return isNumber(value) ? value : null;
}

const invalid = (action: Action) =>
  new ProviderError(
    CHAT_PROVIDER_ID,
    'invalid_response' as ProviderErrorKind,
    `[${action}] Mark 55 ส่งข้อมูลแชทไม่ครบ`,
  );
