import { GeminiAdapter } from '../features/ai/adapters/GeminiAdapter';
import { JevAdapter } from '../features/ai/adapters/JevAdapter';
import { OpenRouterAdapter } from '../features/ai/adapters/OpenRouterAdapter';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import {
  normalizeModelIds,
  parseGeminiModels,
  parseJevModels,
  parseOpenAIModels,
} from '../features/ai/core/modelLists';
import { GEMINI, JEV, OPENROUTER, httpError, json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, setAIKeys } from '../test-utils/setup';

// cast เฉพาะใน test: registry คืน AIProvider แต่ต้องการ type ของ adapter จริง
const gemini = () => aiRegistry.get('gemini') as GeminiAdapter;
const openrouter = () => aiRegistry.get('openrouter') as OpenRouterAdapter;
const jev = () => aiRegistry.get('jev') as JevAdapter;

beforeAll(registerAll);
beforeEach(() => setAIKeys(['gemini', 'openrouter', 'jev']));
afterEach(() => jest.restoreAllMocks());

describe('parsers (pure)', () => {
  test('normalizeModelIds: trim, dedupe, drop empty, sort', () => {
    expect(normalizeModelIds([' b ', 'a', 'b', '', '  '])).toEqual(['a', 'b']);
  });

  test('OpenAI-compatible: data[].id, skips malformed items', () => {
    expect(
      parseOpenAIModels('openrouter', {
        data: [{ id: 'z/m' }, { id: 42 }, 'junk', null, { name: 'no-id' }, { id: 'a/m' }, { id: 'a/m' }],
      })
    ).toEqual(['a/m', 'z/m']);
    expect(parseOpenAIModels('openrouter', {})).toEqual([]);
    expect(parseOpenAIModels('openrouter', { data: 'nope' })).toEqual([]);
  });

  test('Gemini: generateContent only, strips "models/", returns nextPageToken', () => {
    expect(
      parseGeminiModels('gemini', {
        models: [
          { name: 'models/gemini-3-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/no-methods' },
          { name: 7, supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3-flash', supportedGenerationMethods: 'generateContent' },
          { name: 'gemini-2.5-flash', supportedGenerationMethods: ['countTokens', 'generateContent'] },
        ],
        nextPageToken: 'p2',
      })
    ).toEqual({ ids: ['gemini-2.5-flash', 'gemini-3-pro'], nextPageToken: 'p2' });
    expect(parseGeminiModels('gemini', { nextPageToken: '' })).toEqual({ ids: [], nextPageToken: undefined });
  });

  test('Jev: models[].name', () => {
    expect(parseJevModels('jev', { models: [{ name: 'jev-preview' }, { name: 'jev-latest' }, {}] })).toEqual([
      'jev-latest',
      'jev-preview',
    ]);
  });

  test.each([
    ['array', []],
    ['null', null],
    ['string', 'models'],
  ])('body that is not an object (%s) → invalid_response with a Thai message', (_label, body) => {
    for (const parse of [parseOpenAIModels, parseJevModels, parseGeminiModels]) {
      expect(() => parse('x', body)).toThrow('[x] รายชื่อโมเดลอยู่ในรูปแบบที่อ่านไม่ได้');
    }
  });
});

describe('listModels() over core/http (mocked fetch)', () => {
  test('Gemini: GET /v1beta/models with x-goog-api-key, follows pages, key never in the URL', async () => {
    const { calls } = mockFetch([
      [
        GEMINI,
        (call) =>
          call.url.searchParams.get('pageToken') === 'p2'
            ? json({ models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] })
            : json({
                models: [
                  { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] },
                  { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
                ],
                nextPageToken: 'p2',
              }),
      ],
    ]);
    await expect(gemini().listModels()).resolves.toEqual(['gemini-2.5-pro', 'gemini-3-flash']);
    expect(calls).toHaveLength(2);
    const first = nth(calls, 0);
    expect(`${first.method} ${first.url.pathname}`).toBe('GET /v1beta/models');
    expect(first.url.searchParams.get('pageSize')).toBe('1000');
    expect(first.headers['x-goog-api-key']).toBe('gemini-test-key');
    for (const c of calls) {
      expect(c.url.searchParams.has('key')).toBe(false);
      expect(c.url.href).not.toContain('gemini-test-key');
    }
  });

  test('Gemini: stops after 5 pages even if the API keeps sending a token', async () => {
    const { calls } = mockFetch([[GEMINI, () => json({ models: [], nextPageToken: 'again' })]]);
    await expect(gemini().listModels()).resolves.toEqual([]);
    expect(calls).toHaveLength(5);
  });

  test('OpenRouter: GET {baseURL}/models with bearer key, sorted ids', async () => {
    const { calls } = mockFetch([
      [OPENROUTER, () => json({ data: [{ id: 'openai/gpt-5.6' }, { id: 'anthropic/claude-x' }] })],
    ]);
    await expect(openrouter().listModels()).resolves.toEqual(['anthropic/claude-x', 'openai/gpt-5.6']);
    expect(nth(calls, 0).url.href).toBe('https://openrouter.ai/api/v1/models');
    expect(nth(calls, 0).headers.Authorization).toBe('Bearer openrouter-test-key');
  });

  test('Jev: GET /v1/models', async () => {
    const { calls } = mockFetch([[JEV, () => json({ models: [{ name: 'jev-latest' }] })]]);
    await expect(jev().listModels()).resolves.toEqual(['jev-latest']);
    expect(`${nth(calls, 0).method} ${nth(calls, 0).url.pathname}`).toBe('GET /v1/models');
  });

  test('missing key → missing_key without any request', async () => {
    await setAIKeys([]);
    const { spy } = mockFetch([]);
    await expect(gemini().listModels()).rejects.toMatchObject({ kind: 'missing_key' });
    await expect(openrouter().listModels()).rejects.toMatchObject({ kind: 'missing_key' });
    await expect(jev().listModels()).rejects.toMatchObject({ kind: 'missing_key' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('HTTP 401 → auth error; echoed key is redacted', async () => {
    mockFetch([[OPENROUTER, () => httpError(401, 'bad key sk-or-v1-abcdef123456')]]);
    const err: unknown = await openrouter().listModels().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'auth' });
    expect(String(err)).not.toContain('sk-or-v1-abcdef123456');
    expect(String(err)).toContain('[REDACTED]');
  });

  test('non-object JSON body → invalid_response', async () => {
    mockFetch([[JEV, () => json(['jev-latest'])]]);
    await expect(jev().listModels()).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
