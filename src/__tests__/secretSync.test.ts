import { request } from '../core/http/request';
import {
  ALLOWED_KEY_PREFIXES,
  parseDocuments,
  parseSecretLines,
  SecretSync,
  SECRETS_CONTAINER_TAG,
  SECRETS_SEARCH_ENDPOINT,
  SUPERMEMORY_KEY_NAME,
} from '../core/memory/SecretSync';
import type { KeyStore } from '../core/storage/SecureKeyStore';
import { nth } from '../test-utils/nth';

/** keyStore ปลอม (Map) — ของจริงใช้ SecureStore */
function fakeKeyStore(
  initial: Record<string, string> = {},
): Pick<KeyStore, 'get' | 'set' | 'has'> & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: jest.fn(async (k: string) => data.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void data.set(k, v)),
    has: jest.fn(async (k: string) => data.has(k) && data.get(k) !== ''),
  };
}

/** fetcher ปลอมที่คืน body ตามกำหนด (เลียน request() → Response) */
function fakeFetcher(body: unknown) {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fetcher = jest.fn(async (_id: string, url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    return { json: async () => body } as Response;
  }) as unknown as typeof request;
  return { fetcher, calls };
}

describe('parseSecretLines', () => {
  test('รับ name = value / name: value · ข้ามคอมเมนต์+บรรทัดเปล่า · รับเฉพาะ prefix ที่อนุญาต', () => {
    const content = [
      '# คีย์ของบอส',
      'ai.gemini = AIzaXXX',
      'tts.elevenlabs: el-secret',
      '  stt.openai = sk-openai  ',
      'mark55.auth.token = should-be-blocked', // ไม่อยู่ใน allowlist
      'supermemory.apiKey = loop-blocked', // กัน bootstrap loop
      'not a key line',
      'bad key!=x',
    ].join('\n');
    expect(parseSecretLines(content)).toEqual([
      { name: 'ai.gemini', value: 'AIzaXXX' },
      { name: 'tts.elevenlabs', value: 'el-secret' },
      { name: 'stt.openai', value: 'sk-openai' },
    ]);
  });

  test('ALLOWED_KEY_PREFIXES ครอบ ai/tts/stt/mcp/pcbridge', () => {
    expect([...ALLOWED_KEY_PREFIXES]).toEqual(['ai.', 'tts.', 'stt.', 'mcp.', 'pcbridge.']);
  });
});

describe('parseDocuments', () => {
  test('รองรับ content / memory / text / chunks[].content · ข้ามรูปแบบแปลก', () => {
    expect(
      parseDocuments({
        results: [
          { content: 'ai.gemini = a' },
          { memory: 'tts.polly = b' },
          { text: 'stt.azure = c' },
          { chunks: [{ content: 'mcp.x = d' }, { content: 'pcbridge.anonKey = e' }] },
          { nope: 1 },
          'string-item',
        ],
      }),
    ).toEqual([
      'ai.gemini = a',
      'tts.polly = b',
      'stt.azure = c',
      'mcp.x = d\npcbridge.anonKey = e',
    ]);
    expect(parseDocuments({ memories: [{ content: 'ai.dahl-glm = m' }] })).toEqual(['ai.dahl-glm = m']);
    expect(parseDocuments({ documents: [{ content: 'ai.gemini = z' }] })).toEqual([
      'ai.gemini = z',
    ]);
    expect(parseDocuments({})).toEqual([]);
    expect(parseDocuments(null)).toEqual([]);
  });
});

describe('SecretSync.importOnce', () => {
  test('ไม่มีคีย์ Supermemory → ข้าม ไม่เรียกเน็ต', async () => {
    const keyStore = fakeKeyStore();
    const { fetcher, calls } = fakeFetcher({});
    const sync = new SecretSync({ keyStore, fetcher });
    await expect(sync.importOnce()).resolves.toEqual({
      imported: 0,
      skipped: 0,
      reason: 'no_supermemory_key',
    });
    expect(calls).toHaveLength(0);
  });

  test('ดึง → เขียน SecureStore · ส่ง containerTag ถูก · ไม่ทับคีย์ที่มีอยู่', async () => {
    const keyStore = fakeKeyStore({ [SUPERMEMORY_KEY_NAME]: 'sm-key', 'ai.gemini': 'already-set' });
    const { fetcher, calls } = fakeFetcher({
      results: [{ content: 'ai.gemini = NEW\ntts.elevenlabs = el\nstt.openai = sk' }],
    });
    const sync = new SecretSync({ keyStore, fetcher });

    const result = await sync.importOnce();
    expect(result).toEqual({ imported: 2, skipped: 1 }); // gemini มีแล้ว = skip
    expect(keyStore.data.get('ai.gemini')).toBe('already-set'); // ไม่ทับ
    expect(keyStore.data.get('tts.elevenlabs')).toBe('el');
    expect(keyStore.data.get('stt.openai')).toBe('sk');

    const call = nth(calls, 0);
    expect(call.url).toBe(SECRETS_SEARCH_ENDPOINT);
    const sent = JSON.parse(call.init.body as string);
    expect(sent).toMatchObject({ containerTags: [SECRETS_CONTAINER_TAG], includeContent: true });
    expect(sent).not.toHaveProperty('q'); // /v3/search ปฏิเสธคำค้นว่าง → ใช้ documents/list
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer sm-key');
  });

  test('overwrite = true → ทับของเดิม', async () => {
    const keyStore = fakeKeyStore({ [SUPERMEMORY_KEY_NAME]: 'sm', 'ai.gemini': 'old' });
    const { fetcher } = fakeFetcher({ results: [{ content: 'ai.gemini = NEW' }] });
    await new SecretSync({ keyStore, fetcher }).importOnce(true);
    expect(keyStore.data.get('ai.gemini')).toBe('NEW');
  });

  test('คีย์ชื่อซ้ำ → ใช้ตัวหลังสุด', async () => {
    const keyStore = fakeKeyStore({ [SUPERMEMORY_KEY_NAME]: 'sm' });
    const { fetcher } = fakeFetcher({
      results: [{ content: 'ai.gemini = first' }, { content: 'ai.gemini = last' }],
    });
    await new SecretSync({ keyStore, fetcher }).importOnce();
    expect(keyStore.data.get('ai.gemini')).toBe('last');
  });

  test('เน็ตล้ม → fail-open (reason error) ไม่ throw', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const keyStore = fakeKeyStore({ [SUPERMEMORY_KEY_NAME]: 'sm' });
    const fetcher = jest.fn(async () =>
      Promise.reject(new Error('offline')),
    ) as unknown as typeof request;
    await expect(new SecretSync({ keyStore, fetcher }).importOnce()).resolves.toEqual({
      imported: 0,
      skipped: 0,
      reason: 'error',
    });
  });

  test('ไม่เขียนคีย์นอก allowlist (เช่น mark55.auth.token) แม้มีใน Supermemory', async () => {
    const keyStore = fakeKeyStore({ [SUPERMEMORY_KEY_NAME]: 'sm' });
    const { fetcher } = fakeFetcher({
      results: [{ content: 'mark55.auth.token = x\nsupermemory.apiKey = y\nai.gemini = ok' }],
    });
    const result = await new SecretSync({ keyStore, fetcher }).importOnce();
    expect(result.imported).toBe(1);
    expect(keyStore.data.has('mark55.auth.token')).toBe(false);
    expect(keyStore.data.get('supermemory.apiKey')).toBe('sm'); // ไม่ถูกทับ
  });
});
