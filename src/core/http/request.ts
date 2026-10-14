import { ProviderError, describeStatus, kindForStatus } from './errors';

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions extends Omit<RequestInit, 'signal'> {
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
      throw new ProviderError(providerId, 'timeout', `หมดเวลา (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw new ProviderError(providerId, 'network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok && !acceptStatus?.includes(res.status)) {
    const detail = await readErrorDetail(res);
    throw new ProviderError(
      providerId,
      kindForStatus(res.status),
      `HTTP ${res.status}: ${describeStatus(res.status)}${detail ? ` — ${detail}` : ''}`,
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

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return '';
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const err = body.error as Record<string, unknown> | string | undefined;
      const msg =
        (typeof err === 'string' ? err : (err?.message as string | undefined)) ??
        (body.message as string | undefined) ??
        (body.detail as string | undefined);
      if (msg) return String(msg).slice(0, 200);
    } catch {
      // not JSON — fall through to raw text
    }
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
