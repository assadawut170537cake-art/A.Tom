import { ProviderError } from '../core/http/errors';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import {
  QUOTA_COOLDOWN_MAX_MS,
  QUOTA_COOLDOWN_MS,
  QuotaGuard,
  isQuotaError,
} from '../features/ai/core/QuotaGuard';
import {
  GEMINI,
  OPENROUTER,
  geminiText,
  httpError,
  mockFetch,
  openRouterText,
} from '../test-utils/mockFetch';
import { registerAll, resetSettings, setAIKeys } from '../test-utils/setup';

const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
const QUOTA_429 = () => httpError(429, 'You exceeded your current quota, please check your plan');
/** ชื่อโมเดลจาก URL ของ Gemini `/v1beta/models/<model>:generateContent` */
const modelOf = (url: URL) =>
  decodeURIComponent(url.pathname.split('/')[3] ?? '').replace(/:.*/, '');

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

beforeAll(registerAll);
beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
  await ProviderSettings.setEnabled('openrouter', false); // ให้ Gemini เป็นเจ้าเดียว เห็นการสลับรุ่นชัด
});
afterEach(() => jest.restoreAllMocks());

describe('QuotaGuard', () => {
  test('พัก 60s → เพิ่มเท่าตัวทุกครั้งที่ยังหมด · สูงสุด 1 ชม. · clear = นับใหม่', () => {
    const c = clock();
    const q = new QuotaGuard(c.now);
    expect(q.strike('gemini', 'm')).toBe(1);
    expect(q.isCooling('gemini', 'm')).toBe(true);
    expect(q.isCooling('gemini', 'other')).toBe(false); // นับแยกต่อโมเดล
    c.advance(QUOTA_COOLDOWN_MS);
    expect(q.isCooling('gemini', 'm')).toBe(false);
    q.strike('gemini', 'm'); // ครั้งที่ 2 = 120s
    c.advance(QUOTA_COOLDOWN_MS);
    expect(q.isCooling('gemini', 'm')).toBe(true);
    for (let i = 0; i < 10; i++) q.strike('gemini', 'm');
    c.advance(QUOTA_COOLDOWN_MAX_MS);
    expect(q.isCooling('gemini', 'm')).toBe(false);
    q.clear('gemini', 'm');
    expect(q.strike('gemini', 'm')).toBe(1);
  });

  test('isQuotaError: 429 + quota/exhausted เท่านั้น', () => {
    expect(
      isQuotaError(
        new ProviderError('gemini', 'rate_limit', 'HTTP 429 — You exceeded your current quota'),
      ),
    ).toBe(true);
    expect(
      isQuotaError(new ProviderError('gemini', 'rate_limit', 'Resource has been exhausted')),
    ).toBe(true);
    expect(isQuotaError(new ProviderError('gemini', 'rate_limit', 'HTTP 429: error 429'))).toBe(
      false,
    );
    expect(isQuotaError(new ProviderError('gemini', 'server', 'quota service down'))).toBe(false);
  });
});

describe('Orchestrator ปรับตัวเองเมื่อโควต้าหมด (ADR-017)', () => {
  test('รุ่นที่เลือกหมด → สลับรุ่นสำรองให้เอง + แจ้งบอสครั้งเดียว · รอบถัดไปไม่ยิงรุ่นที่หมดซ้ำ', async () => {
    const { calls } = mockFetch([
      [
        GEMINI,
        (c) =>
          modelOf(c.url) === 'gemini-3-flash' ? QUOTA_429() : geminiText(`จาก ${modelOf(c.url)}`),
      ],
    ]);
    const orch = new Orchestrator(aiRegistry, ProviderSettings, new QuotaGuard(clock().now));

    const first = await orch.chat({ messages: MESSAGES });
    expect(first.content).toBe('จาก gemini-2.5-flash');
    expect(calls.map((c) => modelOf(c.url))).toEqual(['gemini-3-flash', 'gemini-2.5-flash']);
    expect(orch.takeNotices()).toEqual([
      'Google Gemini: โควต้าของ gemini-3-flash หมดชั่วคราว — สลับไปใช้ gemini-2.5-flash ให้เองแล้ว',
    ]);

    await orch.chat({ messages: MESSAGES });
    expect(calls.slice(2).map((c) => modelOf(c.url))).toEqual(['gemini-2.5-flash']); // ข้ามตัวที่พักอยู่
    expect(orch.takeNotices()).toEqual([]);
  });

  test('ครบเวลาพัก → กลับไปลองรุ่นที่บอสเลือก', async () => {
    let exhausted = true;
    const { calls } = mockFetch([
      [
        GEMINI,
        (c) => (exhausted && modelOf(c.url) === 'gemini-3-flash' ? QUOTA_429() : geminiText('ok')),
      ],
    ]);
    const c = clock();
    const orch = new Orchestrator(aiRegistry, ProviderSettings, new QuotaGuard(c.now));
    await orch.chat({ messages: MESSAGES });
    exhausted = false;
    c.advance(QUOTA_COOLDOWN_MS);
    await orch.chat({ messages: MESSAGES });
    expect(calls.map((x) => modelOf(x.url))).toEqual([
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-3-flash',
    ]);
  });

  test('รุ่นสำรองไม่มีจริง (404) → ข้ามไปรุ่นถัดไปเงียบ ๆ', async () => {
    const { calls } = mockFetch([
      [
        GEMINI,
        (c) => {
          const m = modelOf(c.url);
          if (m === 'gemini-3-flash') return QUOTA_429();
          if (m === 'gemini-2.5-flash') return httpError(404, 'model not found');
          return geminiText('lite ตอบ');
        },
      ],
    ]);
    const res = await new Orchestrator(
      aiRegistry,
      ProviderSettings,
      new QuotaGuard(clock().now),
    ).chat({
      messages: MESSAGES,
    });
    expect(res.content).toBe('lite ตอบ');
    expect(calls.map((c) => modelOf(c.url))).toEqual([
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
  });

  test('ทุกรุ่นหมด → ไปเจ้าถัดไป · รอบหน้าข้าม Gemini ทั้งเจ้าโดยไม่ยิงเลย', async () => {
    await ProviderSettings.setEnabled('openrouter', true);
    await ProviderSettings.setPriority(['gemini', 'openrouter']);
    const { hosts } = mockFetch([
      [GEMINI, QUOTA_429],
      [OPENROUTER, () => openRouterText('จาก OpenRouter')],
    ]);
    const orch = new Orchestrator(aiRegistry, ProviderSettings, new QuotaGuard(clock().now));
    await expect(orch.chat({ messages: MESSAGES })).resolves.toMatchObject({
      providerId: 'openrouter',
    });
    expect(hosts().filter((h) => h.startsWith('generative'))).toHaveLength(3);

    // pin Gemini ไว้หน้าสุด (ไม่งั้น lastGood = OpenRouter อยู่แล้ว) — ทุกรุ่นพักอยู่จึงข้ามทั้งเจ้า
    await orch.chat({ messages: MESSAGES, providerId: 'gemini' });
    expect(hosts().slice(4)).toEqual(['openrouter.ai']);
  });

  test('ทุกเจ้าพักอยู่หมด → ยังลองจริง (ไม่ล้มทันทีโดยไม่ได้ลอง)', async () => {
    let exhausted = true;
    const { calls } = mockFetch([
      [GEMINI, () => (exhausted ? QUOTA_429() : geminiText('กลับมาแล้ว'))],
    ]);
    const orch = new Orchestrator(aiRegistry, ProviderSettings, new QuotaGuard(clock().now));
    await expect(orch.chat({ messages: MESSAGES })).rejects.toMatchObject({ kind: 'rate_limit' });
    exhausted = false;
    await expect(orch.chat({ messages: MESSAGES })).resolves.toMatchObject({
      content: 'กลับมาแล้ว',
    });
    expect(calls).toHaveLength(4);
  });

  test('429 ทั่วไป (ไม่ใช่โควต้า) → ไม่สลับรุ่น ใช้กติกาเดิม', async () => {
    const { calls } = mockFetch([[GEMINI, () => httpError(429)]]);
    const orch = new Orchestrator(aiRegistry, ProviderSettings, new QuotaGuard(clock().now));
    await expect(orch.chat({ messages: MESSAGES })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(calls).toHaveLength(1);
  });
});
