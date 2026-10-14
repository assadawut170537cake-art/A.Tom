export type ProviderErrorKind =
  | 'auth' // 401 / 403
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'bad_request' // other 4xx
  | 'missing_key'
  | 'unsupported'
  | 'invalid_response';

/** Error thrown by every AI / voice provider so orchestrators can decide whether to fall back. */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(providerId: string, kind: ProviderErrorKind, message: string, status?: number) {
    super(`[${providerId}] ${message}`);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.kind = kind;
    this.status = status;
  }

  /** Failures where trying the next provider makes sense: 401/403/429/5xx/timeout/network/no key. */
  get shouldFallback(): boolean {
    return (
      this.kind === 'auth' ||
      this.kind === 'rate_limit' ||
      this.kind === 'server' ||
      this.kind === 'timeout' ||
      this.kind === 'network' ||
      this.kind === 'missing_key' ||
      this.kind === 'unsupported'
    );
  }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

const STATUS_TEXT: Partial<Record<ProviderErrorKind, string>> = {
  auth: 'API key ไม่ถูกต้องหรือไม่มีสิทธิ์',
  rate_limit: 'เรียกใช้ถี่เกินไป (rate limit)',
  server: 'เซิร์ฟเวอร์ผู้ให้บริการขัดข้อง',
};

export function describeStatus(status: number): string {
  return STATUS_TEXT[kindForStatus(status)] ?? `คำขอไม่ถูกต้อง`;
}

export function toProviderError(providerId: string, e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  return new ProviderError(providerId, 'network', e instanceof Error ? e.message : String(e));
}

/** Shape returned by every provider's testConnection(). */
export async function testWith(
  providerId: string,
  check: () => Promise<unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    await check();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toProviderError(providerId, e).message };
  }
}
