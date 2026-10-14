import { ProviderError, describeKind, kindForStatus } from './errors';

const DEFAULT_TIMEOUT_MS = 30_000;

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
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
    throw new ProviderError(providerId, 'network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Reading the body consumes it; accepted error statuses are only used by key probes
    const { detail, raw } = await readErrorDetail(res);
    // Google APIs answer an invalid API key with 400 API_KEY_INVALID instead of 401
    const kind = /API_KEY_INVALID|API key not valid/i.test(raw) ? 'auth' : kindForStatus(res.status);
    if (kind !== 'auth' && acceptStatus?.includes(res.status)) return res;
    throw new ProviderError(
      providerId,
      kind,
      `HTTP ${res.status}: ${describeKind(kind)}${detail ? ` — ${detail}` : ''}`,
      res.status
    );
  }
  return res;
}

export async function requestJson<T>(
  providerId: string,
  url: string,
  opts?: RequestOptions
): Promise<T> {
  const res = await request(providerId, url, opts);
  try {
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

/** Pulls a human-readable message out of the common error body shapes. */
async function readErrorDetail(res: Response): Promise<{ detail: string; raw: string }> {
  let raw = '';
  try {
    raw = (await res.text()).trim();
  } catch {
    return { detail: '', raw };
  }
  if (!raw) return { detail: '', raw };
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const msg =
      messageOf(body.error) ??
      messageOf(body.detail) ??
      messageOf(body.message) ??
      messageOf(body.title);
    if (msg) return { detail: msg.slice(0, 200), raw };
  } catch {
    // not JSON — fall through to raw text
  }
  return { detail: raw.slice(0, 200), raw };
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return messageOf(value[0]);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return messageOf(obj.message) ?? messageOf(obj.msg);
  }
  return undefined;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
