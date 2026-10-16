import { ProviderError } from '../core/http/errors';
import {
  REMOTE_TIMEOUT_MS,
  RemoteMemoryAdapter,
  SYNC_VERSION,
  fromWire,
  normalizeServerUrl,
  syncErrorText,
  toWire,
} from '../core/memory/RemoteMemoryAdapter';
import type { SyncFact } from '../core/memory/types';
import { hangingFetch, httpError, json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';

const BASE = 'http://192.168.1.10:8787';
const MARK55 = /192\.168\.1\.10:8787/;
const TOKEN = 'jwt.test.token';

const GLOBAL_FACT: SyncFact = { target: { scope: 'global' }, key: 'nickname', value: 'ต้น', updatedAt: 1000, deleted: false };
const ATOM_TOMBSTONE: SyncFact = { target: { scope: 'persona', persona: 1 }, key: 'joke', value: '', updatedAt: 2000, deleted: true };

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const paired = () => new RemoteMemoryAdapter({ baseUrl: `${BASE}/`, token: TOKEN });

/** ProviderError ที่ promise reject ออกมา */
async function failure(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error('expected a rejection');
}

describe('pair()', () => {
  test('POST /api/v1/auth/pair → token + expiresAt; the adapter uses the new token right away', async () => {
    const { calls } = mockFetch([
      [/auth\/pair/, () => json({ token: TOKEN, expiresAt: '2026-11-15T00:00:00.000Z' })],
      [/memory\/sync/, () => json({ facts: [], serverTimestamp: 5 })],
    ]);
    const remote = new RemoteMemoryAdapter({ baseUrl: BASE });
    expect(remote.isPaired).toBe(false);

    await expect(remote.pair(' 123456 ', 'A.T.O.M. (android)')).resolves.toEqual({
      token: TOKEN,
      expiresAt: Date.parse('2026-11-15T00:00:00.000Z'),
    });
    const call = nth(calls, 0);
    expect(call.method).toBe('POST');
    expect(call.url.href).toBe(`${BASE}/api/v1/auth/pair`);
    expect(call.body).toEqual({ code: '123456', deviceName: 'A.T.O.M. (android)' });
    expect(call.headers.Authorization).toBeUndefined();

    expect(remote.isPaired).toBe(true);
    await remote.pull(0);
    expect(nth(calls, 1).headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('rejects a code that is not 6 digits without calling the server', async () => {
    const { calls } = mockFetch([]);
    const e = await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).pair('12a45', 'x'));
    expect(e.kind).toBe('bad_request');
    expect(syncErrorText(e)).toBe('รหัสจับคู่ต้องเป็นตัวเลข 6 หลัก');
    expect(calls).toHaveLength(0);
  });

  test('401 → Thai "wrong or expired code" (auth)', async () => {
    mockFetch([[MARK55, () => httpError(401, 'invalid pairing code')]]);
    const e = await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).pair('000000', 'x'));
    expect(e).toMatchObject({ kind: 'auth', status: 401, providerId: 'mark55' });
    expect(syncErrorText(e)).toBe('รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ — ขอรหัสใหม่จาก Mark 55 แล้วลองอีกครั้ง');
  });

  test('429 → Thai rate-limit message (5 per minute)', async () => {
    mockFetch([[MARK55, () => httpError(429)]]);
    const e = await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).pair('123456', 'x'));
    expect(e.kind).toBe('rate_limit');
    expect(syncErrorText(e)).toContain('5 ครั้งต่อนาที');
  });

  test('network failure → network kind with Wi-Fi advice', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const e = await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).pair('123456', 'x'));
    expect(e.kind).toBe('network');
    expect(syncErrorText(e)).toContain('Wi-Fi เดียวกับ PC');
  });

  test('a response without a token is invalid_response', async () => {
    mockFetch([[MARK55, () => json({ ok: true })]]);
    const remote = new RemoteMemoryAdapter({ baseUrl: BASE });
    expect((await failure(remote.pair('123456', 'x'))).kind).toBe('invalid_response');
    expect(remote.isPaired).toBe(false);
  });
});

describe('verify()', () => {
  test('GET /api/v1/auth/verify with Bearer token', async () => {
    const { calls } = mockFetch([
      [/auth\/verify/, () => json({ valid: true, deviceName: 'Pixel', expiresAt: 1_900_000_000_000 })],
    ]);
    await expect(paired().verify()).resolves.toEqual({ valid: true, deviceName: 'Pixel', expiresAt: 1_900_000_000_000 });
    expect(nth(calls, 0).headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('401 or no token → valid: false (does not throw)', async () => {
    mockFetch([[MARK55, () => httpError(401)]]);
    await expect(paired().verify()).resolves.toEqual({ valid: false, deviceName: null, expiresAt: null });
    await expect(new RemoteMemoryAdapter({ baseUrl: BASE }).verify()).resolves.toMatchObject({ valid: false });
  });

  test('server without /auth/verify (404) → probes /memory/sync instead', async () => {
    const { calls } = mockFetch([
      [/auth\/verify/, () => httpError(404, 'Not Found')],
      [/memory\/sync/, () => json({ facts: [], serverTimestamp: 1 })],
    ]);
    await expect(paired().verify()).resolves.toEqual({ valid: true, deviceName: null, expiresAt: null });
    expect(calls.map((c) => c.url.pathname)).toEqual(['/api/v1/auth/verify', '/api/v1/memory/sync']);
  });

  test('offline → throws (the caller shows 🔴, not "unpaired")', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    expect((await failure(paired().verify())).kind).toBe('network');
  });
});

describe('pull()', () => {
  test('GET /memory/sync?since= → facts in app form (persona "1" → 1, tombstones kept)', async () => {
    const { calls } = mockFetch([
      [
        /memory\/sync/,
        () =>
          json({
            facts: [
              { target: 'global', key: 'nickname', value: 'ต้น', updatedAt: 1000 },
              { target: { persona: '1' }, key: 'joke', value: '', updatedAt: 2000, deleted: true },
            ],
            serverTimestamp: 3000,
          }),
      ],
    ]);
    await expect(paired().pull(1234.7)).resolves.toEqual({ facts: [GLOBAL_FACT, ATOM_TOMBSTONE], serverTimestamp: 3000 });
    const call = nth(calls, 0);
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/v1/memory/sync');
    expect(call.url.searchParams.get('since')).toBe('1234');
  });

  test('malformed facts are skipped with a log instead of failing the whole pull', async () => {
    mockFetch([
      [
        /memory\/sync/,
        () =>
          json({
            facts: [
              { target: 'global', key: 'nickname', value: 'ต้น', updatedAt: 1000 },
              { target: { persona: '9' }, key: 'x', value: 'y', updatedAt: 1 },
              { target: 'global', key: 'bad key!', value: 'y', updatedAt: 1 },
              { target: 'global', key: 'noTime', value: 'y' },
              'junk',
            ],
            syncedAt: '1970-01-01T00:00:05.000Z',
          }),
      ],
    ]);
    await expect(paired().pull(0)).resolves.toEqual({ facts: [GLOBAL_FACT], serverTimestamp: 5000 });
    expect(errorSpy).toHaveBeenCalledWith('[memory:remote] ข้าม fact ที่รูปแบบไม่ถูกต้อง 4 รายการ');
  });

  test('missing facts or server time → invalid_response', async () => {
    mockFetch([[/memory\/sync/, () => json({ facts: [] })]]);
    expect((await failure(paired().pull(0))).kind).toBe('invalid_response');
  });

  test('no token → missing_key without calling the server', async () => {
    const { calls } = mockFetch([]);
    const e = await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).pull(0));
    expect(e.kind).toBe('missing_key');
    expect(syncErrorText(e)).toContain('ตั้งค่า › Sync');
    expect(calls).toHaveLength(0);
  });

  test('401 on sync → "pairing expired" message', async () => {
    mockFetch([[MARK55, () => httpError(401, 'jwt expired')]]);
    const e = await failure(paired().pull(0));
    expect(e.kind).toBe('auth');
    expect(syncErrorText(e)).toBe('การจับคู่หมดอายุหรือถูกยกเลิก — จับคู่ใหม่ที่ ตั้งค่า › Sync');
  });
});

describe('push()', () => {
  test('POST /memory/sync with version + lastSyncAt + wire facts', async () => {
    const { calls } = mockFetch([[/memory\/sync/, () => json({ applied: 2, conflicts: [], serverTimestamp: 9000 })]]);
    await expect(paired().push([GLOBAL_FACT, ATOM_TOMBSTONE], 500)).resolves.toEqual({
      applied: 2,
      conflicts: [],
      serverTimestamp: 9000,
    });
    const call = nth(calls, 0);
    expect(call.method).toBe('POST');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({
      version: SYNC_VERSION,
      lastSyncAt: 500,
      facts: [
        { target: 'global', key: 'nickname', value: 'ต้น', updatedAt: 1000 },
        { target: { persona: '1' }, key: 'joke', value: '', updatedAt: 2000, deleted: true },
      ],
    });
  });

  test('conflicts carry the server copy (several shapes accepted)', async () => {
    const serverCopy = { target: 'global', key: 'nickname', value: 'เค้ก', updatedAt: 5000 };
    mockFetch([
      [
        /memory\/sync/,
        () =>
          json({
            applied: [{}],
            conflicts: [{ target: 'global', key: 'nickname', server: serverCopy }, serverCopy, { key: 'noTarget' }, 7],
            serverTimestamp: 9000,
          }),
      ],
    ]);
    const res = await paired().push([GLOBAL_FACT], 0);
    expect(res.applied).toBe(1);
    const winner: SyncFact = { ...GLOBAL_FACT, value: 'เค้ก', updatedAt: 5000 };
    expect(res.conflicts).toEqual([
      { target: { scope: 'global' }, key: 'nickname', server: winner },
      { target: { scope: 'global' }, key: 'nickname', server: winner },
    ]);
  });

  test('400 (e.g. clock skew > 1 day) → bad_request with the server detail', async () => {
    mockFetch([[MARK55, () => httpError(400, 'updatedAt too far in the future')]]);
    const e = await failure(paired().push([GLOBAL_FACT], 0));
    expect(e.kind).toBe('bad_request');
    expect(syncErrorText(e)).toContain('updatedAt too far in the future');
  });

  test('5xx → server kind with the status', async () => {
    mockFetch([[MARK55, () => httpError(503)]]);
    const e = await failure(paired().push([GLOBAL_FACT], 0));
    expect(e.kind).toBe('server');
    expect(syncErrorText(e)).toContain('HTTP 503');
  });

  test('non-JSON body → invalid_response', async () => {
    mockFetch([[MARK55, () => new Response('<html>proxy</html>', { status: 200 })]]);
    expect((await failure(paired().push([GLOBAL_FACT], 0))).kind).toBe('invalid_response');
  });
});

describe('health()', () => {
  test('GET /api/v1/health without a token', async () => {
    const { calls } = mockFetch([[/health/, () => json({ status: 'ok', version: '0.1.0', uptime: 42 })]]);
    await expect(new RemoteMemoryAdapter({ baseUrl: BASE }).health()).resolves.toEqual({
      status: 'ok',
      version: '0.1.0',
      uptime: 42,
    });
    expect(nth(calls, 0).url.href).toBe(`${BASE}/api/v1/health`);
    expect(nth(calls, 0).headers.Authorization).toBeUndefined();
  });

  test('times out after 10s by default', async () => {
    jest.useFakeTimers();
    try {
      hangingFetch();
      const pending = failure(new RemoteMemoryAdapter({ baseUrl: BASE }).health());
      jest.advanceTimersByTime(REMOTE_TIMEOUT_MS);
      const e = await pending;
      expect(e.kind).toBe('timeout');
      expect(syncErrorText(e)).toContain('10 วินาที');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a page that is not Mark 55 → invalid_response', async () => {
    mockFetch([[MARK55, () => json({ hello: 'world' })]]);
    expect((await failure(new RemoteMemoryAdapter({ baseUrl: BASE }).health())).kind).toBe('invalid_response');
  });
});

describe('wire format helpers', () => {
  test('toWire/fromWire round-trip', () => {
    for (const fact of [GLOBAL_FACT, ATOM_TOMBSTONE]) expect(fromWire(toWire(fact))).toEqual(fact);
    expect(fromWire({ target: { persona: 2 }, key: 'k', value: 'v', updatedAt: 1 })).toMatchObject({
      target: { scope: 'persona', persona: 2 },
    });
    expect(fromWire({ target: 'global', key: 'k', updatedAt: 1 })).toBeNull(); // no value, not deleted
    expect(fromWire({ target: 'global', key: 'k', updatedAt: 1, deleted: true })).toMatchObject({ value: '' });
  });

  test('normalizeServerUrl', () => {
    expect(normalizeServerUrl(' http://192.168.1.10:8787/ ')).toEqual({ url: 'http://192.168.1.10:8787' });
    expect(normalizeServerUrl('192.168.1.10:8787/api/v1')).toEqual({ url: 'http://192.168.1.10:8787' });
    expect(normalizeServerUrl('HTTP://Mark55.local:8787')).toEqual({ url: 'http://mark55.local:8787' });
    expect(normalizeServerUrl('http://10.0.2.2:8787')).toEqual({ url: 'http://10.0.2.2:8787' });
    expect(normalizeServerUrl('http://100.101.1.2:8787')).toEqual({ url: 'http://100.101.1.2:8787' });
    expect(normalizeServerUrl('https://mark55.example.com')).toEqual({ url: 'https://mark55.example.com' });
    expect(normalizeServerUrl('')).toEqual({ error: expect.stringContaining('ใส่ Server URL') });
    expect(normalizeServerUrl('http://8.8.8.8:8787')).toEqual({ error: expect.stringContaining('https://') });
    expect(normalizeServerUrl('http://192.168.1.10:99999')).toEqual({ error: expect.stringContaining('พอร์ต') });
    expect(normalizeServerUrl('ftp://192.168.1.10')).toEqual({ error: expect.stringContaining('ไม่ถูกต้อง') });
    expect(normalizeServerUrl('http://192.168.1.10/path')).toEqual({ error: expect.stringContaining('ไม่ถูกต้อง') });
  });
});
