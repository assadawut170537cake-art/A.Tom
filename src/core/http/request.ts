/**
 * @file HTTP client กลางของทุก provider (AI 3 + TTS 9 + STT 8)
 *
 * ทุกการเรียก API ต้องผ่าน `request()` / `requestJson()` / `requestBytes()` ในไฟล์นี้
 * เพื่อให้ได้พฤติกรรมเดียวกันทั้งแอป:
 *
 * - **Timeout** ด้วย AbortController (ค่าเริ่มต้น 30 วินาที, ปรับได้ใน Advanced) → `timeout`
 * - **HTTP status → ProviderError.kind**: 401/403 → `auth`, 429 → `rate_limit`, 5xx → `server`,
 *   4xx อื่น → `bad_request` (Google ตอบ key ผิดเป็น 400 `API_KEY_INVALID` → นับเป็น `auth`)
 * - **fetch ล้ม** (ออฟไลน์, DNS) → `network` พร้อมข้อความไทย
 * - **Redaction**: API key (`sk-…`, `AIza…`) ใน error body ถูกแทนด้วย `[REDACTED]`
 *   ก่อนตัดเหลือ 200 ตัวอักษร เพราะข้อความ error ถูกบันทึกลงประวัติแชท
 *
 * Orchestrator ใช้ `kind` ที่ได้จากที่นี่ตัดสินใจ retry / fallback
 *
 * @see ../../../docs/ARCHITECTURE.md — หัวข้อ 8 Error handling
 * @see ../../../docs/DECISIONS.md — ADR-001 (fetch ตรง ไม่ใช้ SDK)
 */

import { fetch as expoFetch } from 'expo/fetch';

import { isRecord, parseJSON } from '../types/guards';
import { ProviderError, describeKind, kindForStatus, redactSecrets } from './errors';

const DEFAULT_TIMEOUT_MS = 30_000;

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number | undefined;
  /** Extra HTTP statuses to treat as success (e.g. 400 for "key valid, payload rejected" probes). */
  acceptStatus?: number[];
}

/**
 * fetch() with a timeout and uniform error mapping: 401/403/429/5xx/timeout/network all throw
 * a ProviderError carrying the HTTP status and a short excerpt of the provider's error body.
 */
export async function request(
  providerId: string,
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, acceptStatus, ...init }: RequestOptions = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ProviderError(providerId, 'timeout', `หมดเวลา (${timeoutMs / 1000}s)`);
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new ProviderError(providerId, 'network', `เชื่อมต่อเครือข่ายไม่ได้ (${redactSecrets(reason)})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await errorForResponse(providerId, res, acceptStatus);
    if (err) throw err;
  }
  return res;
}

/** HTTP error → ProviderError (null = status อยู่ใน acceptStatus ให้ถือว่าสำเร็จ) */
async function errorForResponse(
  providerId: string,
  res: Response,
  acceptStatus?: number[]
): Promise<ProviderError | null> {
  // Reading the body consumes it; accepted error statuses are only used by key probes
  const { detail, raw } = await readErrorDetail(res);
  // Google APIs answer an invalid API key with 400 API_KEY_INVALID instead of 401
  const kind = /API_KEY_INVALID|API key not valid/i.test(raw) ? 'auth' : kindForStatus(res.status);
  if (kind !== 'auth' && acceptStatus?.includes(res.status)) return null;
  return new ProviderError(
    providerId,
    kind,
    `HTTP ${res.status}: ${describeKind(kind)}${detail ? ` — ${detail}` : ''}`,
    res.status
  );
}

/**
 * fetch ที่อ่าน body เป็น stream ได้: fetch ของ React Native (XHR) รอจนได้ body ครบก่อน
 * ส่วน `expo/fetch` ส่ง chunk ระหว่างทาง — ใช้กับคำตอบแบบไหล (SSE) เท่านั้น
 */
// Cast: expo/fetch ใช้ type ของตัวเอง (FetchRequestInit/FetchResponse) แต่รูปแบบตรงกับ WHATWG fetch ที่ใช้ที่นี่
const streamingFetch = expoFetch as unknown as typeof fetch;

/**
 * POST แล้วอ่านคำตอบแบบ Server-Sent Events — เรียก `onData` ทีละ `data:` (ไม่รวม `[DONE]`)
 * timeout นับแบบ "เงียบนานเกิน" (รีเซ็ตทุก chunk) เพราะคำตอบยาว ๆ ไหลนานกว่า timeout ปกติได้
 * error mapping เหมือน `request()` ทุกอย่าง
 */
export async function requestSSE(
  providerId: string,
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, acceptStatus: _ignored, ...init }: RequestOptions,
  onData: (data: string) => void
): Promise<void> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const timeoutError = () => new ProviderError(providerId, 'timeout', `หมดเวลา (${timeoutMs / 1000}s)`);

  try {
    let res: Response;
    try {
      res = await streamingFetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) throw timeoutError();
      const reason = e instanceof Error ? e.message : String(e);
      throw new ProviderError(providerId, 'network', `เชื่อมต่อเครือข่ายไม่ได้ (${redactSecrets(reason)})`);
    }
    if (!res.ok) throw (await errorForResponse(providerId, res)) ?? new ProviderError(providerId, 'server', `HTTP ${res.status}`);

    let buffer = '';
    let sawEvent = false;
    const flush = (final: boolean) => {
      // ตอบกลับเป็น JSON ธรรมดา (server/proxy ไม่ส่ง SSE) → ส่งทั้งก้อนเป็น event เดียว
      if (final && !sawEvent && /^\s*[[{]/.test(buffer)) {
        const whole = buffer.trim();
        buffer = '';
        if (whole) onData(whole);
        return;
      }
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = final ? '' : (events.pop() ?? '');
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) sawEvent = true;
        if (data && data !== '[DONE]') onData(data);
      }
    };

    const reader = res.body?.getReader();
    if (!reader) {
      // runtime ที่ไม่มี stream (เช่น test) — อ่านทั้งก้อนแล้วแยก event เหมือนกัน
      buffer = await res.text();
      flush(true);
      return;
    }
    const decoder = new TextDecoder();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (controller.signal.aborted) throw timeoutError();
        const reason = e instanceof Error ? e.message : String(e);
        throw new ProviderError(providerId, 'network', `การเชื่อมต่อหลุดระหว่างรับคำตอบ (${redactSecrets(reason)})`);
      }
      if (chunk.done) break;
      touch();
      buffer += decoder.decode(chunk.value, { stream: true });
      flush(false);
    }
    buffer += decoder.decode();
    flush(true);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson<T>(
  providerId: string,
  url: string,
  opts?: RequestOptions
): Promise<T> {
  const res = await request(providerId, url, opts);
  try {
    // Compile-time contract with the provider's documented schema; adapters still read every
    // field defensively (optional chaining + explicit invalid_response errors).
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(providerId, 'invalid_response', 'ตอบกลับไม่ใช่ JSON');
  }
}

export async function requestBytes(
  providerId: string,
  url: string,
  opts?: RequestOptions
): Promise<Uint8Array> {
  const res = await request(providerId, url, opts);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Pulls a human-readable message out of the common error body shapes. The detail ends up in
 * ChatHistoryStorage via the conversation's error message, so echoed API keys are redacted
 * (before truncating, so a key cut at the limit can't leak a prefix).
 */
async function readErrorDetail(res: Response): Promise<{ detail: string; raw: string }> {
  let raw = '';
  try {
    raw = (await res.text()).trim();
  } catch {
    return { detail: '', raw };
  }
  if (!raw) return { detail: '', raw };
  const body = parseJSON(raw, isRecord); // not a JSON object → fall back to the raw text
  const msg =
    body &&
    (messageOf(body.error) ??
      messageOf(body.detail) ??
      messageOf(body.message) ??
      messageOf(body.title));
  return { detail: redactSecrets(msg || raw).slice(0, 200), raw };
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return messageOf(value[0]);
  if (isRecord(value)) return messageOf(value.message) ?? messageOf(value.msg);
  return undefined;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
