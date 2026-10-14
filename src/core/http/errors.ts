export type ProviderErrorKind =
  | 'auth' // 401 / 403
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'bad_request' // other 4xx
  | 'missing_key'
  | 'unsupported'
  | 'invalid_response'
  | 'permission'; // OS permission (e.g. microphone) denied — no provider can work around it

/** Error thrown by every AI / voice provider so orchestrators can decide whether to fall back. */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;

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

export function describeKind(kind: ProviderErrorKind): string {
  return STATUS_TEXT[kind] ?? 'คำขอไม่ถูกต้อง';
}

/** What the user should do about each kind of failure (shown above the technical detail). */
const USER_ADVICE: Record<ProviderErrorKind, string> = {
  auth: 'API key ไม่ถูกต้องหรือหมดสิทธิ์ — ตรวจสอบได้ที่ ตั้งค่า › AI',
  missing_key: 'ยังไม่ได้ตั้งค่า API key — เพิ่มได้ที่ ตั้งค่า › AI',
  rate_limit: 'เรียกใช้ถี่เกินไป — รอสักครู่แล้วลองใหม่',
  server: 'เซิร์ฟเวอร์ผู้ให้บริการขัดข้อง — ลองใหม่ภายหลัง',
  timeout: 'ผู้ให้บริการตอบช้าเกินไป — ลองใหม่อีกครั้ง',
  network: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต — ตรวจสอบเครือข่ายแล้วลองใหม่',
  permission: 'ไม่ได้รับอนุญาต — เปิดสิทธิ์ได้ที่การตั้งค่าของเครื่อง',
  unsupported: 'อุปกรณ์นี้ยังไม่รองรับความสามารถนี้',
  bad_request: 'คำขอไม่ถูกต้อง — ลองพิมพ์ใหม่อีกครั้ง',
  invalid_response: 'ผู้ให้บริการตอบกลับมาในรูปแบบที่อ่านไม่ได้ — ลองใหม่อีกครั้ง',
};

export function userAdvice(kind: ProviderErrorKind): string {
  return USER_ADVICE[kind];
}

/**
 * API keys that providers sometimes echo back in error bodies (OpenAI/OpenRouter sk-…, Google AIza…)
 * และ AWS access key id (AKIA + 16 ตัว) ที่ Amazon Polly ส่งกลับมาใน `Credential=` ของ error SigV4
 */
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|AKIA[0-9A-Z]{16})/g;

/** Masks API keys so error text is safe to show and to persist in chat history. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}

export function toProviderError(providerId: string, e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  return new ProviderError(providerId, 'network', e instanceof Error ? e.message : String(e));
}

/** Kind for an aggregated chain failure: the shared kind when all failed alike (e.g. all offline), else 'server'. */
export function commonKind(failures: readonly ProviderError[]): ProviderErrorKind {
  const kinds = new Set(failures.map((f) => f.kind));
  const [only] = kinds;
  return kinds.size === 1 && only ? only : 'server';
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
