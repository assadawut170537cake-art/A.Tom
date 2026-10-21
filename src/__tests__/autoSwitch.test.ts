import { ProviderError, type ProviderErrorKind } from '../core/http/errors';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { Orchestrator, aiOrchestrator } from '../features/ai/core/Orchestrator';
import { ProviderRegistry } from '../features/ai/core/ProviderRegistry';
import type {
  AIProvider,
  AIProviderConfig,
  AIProviderId,
  ChatRequest,
} from '../features/ai/core/types';
import { splitSentences } from '../features/voice/core/sentences';
import { VoiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { VoiceRegistry } from '../features/voice/core/VoiceRegistry';
import type {
  STTProvider,
  STTProviderId,
  TTSProvider,
  TTSProviderId,
} from '../features/voice/core/types';
import {
  GEMINI,
  OPENROUTER,
  geminiText,
  hangingFetch,
  httpError,
  json,
  mockFetch,
  openRouterText,
} from '../test-utils/mockFetch';
import { registerAll, resetSettings, setAIKeys } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
});

afterEach(() => jest.restoreAllMocks());

const MESSAGES = [{ role: 'user' as const, content: 'สวัสดี' }];

// ---------------------------------------------------------------------------------------------
// Fake AI providers: each call either returns a reply or throws the next scripted error kind.
// ---------------------------------------------------------------------------------------------

type Step = 'ok' | ProviderErrorKind | Error;

function fakeProvider(
  id: AIProviderId,
  script: Step[] = ['ok'],
  extra: Partial<AIProviderConfig> = {},
): AIProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    requests,
    config: {
      id,
      name: id,
      type: 'openai-compatible',
      baseURL: `https://${id}.test`,
      defaultModel: `${id}-default`,
      models: [`${id}-default`],
      enabled: true,
      purpose: 'llm',
      ...extra,
    },
    async chat(req) {
      requests.push(req);
      const step = script[Math.min(i++, script.length - 1)] ?? 'ok';
      if (step === 'ok') return { content: `reply from ${id}`, model: req.model, providerId: id };
      if (step instanceof Error) throw step;
      throw new ProviderError(id, step, `${step} failure`);
    },
    testConnection: async () => ({ ok: true }),
    getModels: async () => [`${id}-default`],
  };
}

function orchestratorWith(...providers: AIProvider[]) {
  const registry = new ProviderRegistry();
  providers.forEach((p) => registry.register(p));
  return new Orchestrator(registry);
}

describe('AI Orchestrator — priority', () => {
  test('uses registration order when no priority is saved', async () => {
    const a = fakeProvider('gemini');
    const b = fakeProvider('openrouter');
    const res = await orchestratorWith(a, b).chat({ messages: MESSAGES });
    expect(res.providerId).toBe('gemini');
    expect(b.requests).toHaveLength(0);
  });

  test('saved priority wins over registration order; unknown ids are ignored', async () => {
    await ProviderSettings.setPriority(['openrouter', 'gemini']);
    const a = fakeProvider('gemini');
    const b = fakeProvider('openrouter');
    const orch = orchestratorWith(a, b);
    expect((await orch.pickProvider())?.config.id).toBe('openrouter');
    expect((await orch.chat({ messages: MESSAGES })).providerId).toBe('openrouter');
    expect(a.requests).toHaveLength(0);
  });

  test('disabled providers (user override or config) and router providers are skipped', async () => {
    await ProviderSettings.setEnabled('gemini', false);
    const jevLike = fakeProvider('jev', ['ok'], { purpose: 'router' });
    const custom = fakeProvider('custom', ['ok'], { enabled: false });
    const orch = orchestratorWith(
      fakeProvider('gemini'),
      jevLike,
      custom,
      fakeProvider('openrouter'),
    );
    expect((await orch.chat({ messages: MESSAGES })).providerId).toBe('openrouter');
    expect(jevLike.requests).toHaveLength(0);
    expect(custom.requests).toHaveLength(0);
  });

  test('no enabled provider → missing_key error', async () => {
    await ProviderSettings.setEnabled('gemini', false);
    const orch = orchestratorWith(fakeProvider('gemini'));
    await expect(orch.chat({ messages: MESSAGES })).rejects.toMatchObject({ kind: 'missing_key' });
    await expect(orch.pickProvider()).resolves.toBeUndefined();
  });

  test('model: saved per provider, else default; pinned provider + model override', async () => {
    const a = fakeProvider('gemini');
    const b = fakeProvider('openrouter');
    await ProviderSettings.setModelFor('gemini', 'gemini-2.5-pro');
    const orch = orchestratorWith(a, b);

    await orch.chat({ messages: MESSAGES });
    expect(nth(a.requests, 0).model).toBe('gemini-2.5-pro');

    const res = await orch.chat({
      messages: MESSAGES,
      providerId: 'openrouter',
      model: 'x/pinned',
    });
    expect(res.providerId).toBe('openrouter');
    expect(nth(b.requests, 0).model).toBe('x/pinned');
  });
});

describe('AI Orchestrator — fallback', () => {
  test.each<ProviderErrorKind>([
    'auth',
    'rate_limit',
    'server',
    'timeout',
    'network',
    'missing_key',
  ])('%s on the first provider → next provider answers', async (kind) => {
    const a = fakeProvider('gemini', [kind]);
    const b = fakeProvider('openrouter');
    const res = await orchestratorWith(a, b).chat({ messages: MESSAGES });
    expect(res).toMatchObject({ providerId: 'openrouter', content: 'reply from openrouter' });
  });

  test.each<Step>(['bad_request', 'invalid_response'])(
    '%s is not retried on another provider',
    async (kind) => {
      const b = fakeProvider('openrouter');
      await expect(
        orchestratorWith(fakeProvider('gemini', [kind]), b).chat({ messages: MESSAGES }),
      ).rejects.toMatchObject({ kind });
      expect(b.requests).toHaveLength(0);
    },
  );

  test('a plain Error (e.g. fetch blew up) counts as network and falls back', async () => {
    const res = await orchestratorWith(
      fakeProvider('gemini', [new Error('socket hang up')]),
      fakeProvider('openrouter'),
    ).chat({ messages: MESSAGES });
    expect(res.providerId).toBe('openrouter');
  });

  test('all providers fail → one aggregated error listing each failure', async () => {
    const err = (await orchestratorWith(
      fakeProvider('gemini', ['rate_limit']),
      fakeProvider('openrouter', ['server']),
    )
      .chat({ messages: MESSAGES })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/ผู้ให้บริการทุกรายล้มเหลว/);
    expect(err.message).toContain('[gemini] rate_limit failure');
    expect(err.message).toContain('[openrouter] server failure');
  });

  test('last successful provider is tried first next time, and forgotten when it fails', async () => {
    const a = fakeProvider('gemini', ['server', 'ok']);
    const b = fakeProvider('openrouter', ['ok', 'ok', 'server']);
    const orch = orchestratorWith(a, b);

    expect((await orch.chat({ messages: MESSAGES })).providerId).toBe('openrouter'); // a fails
    expect((await orch.chat({ messages: MESSAGES })).providerId).toBe('openrouter'); // cached first
    expect(a.requests).toHaveLength(1);

    // openrouter now fails → gemini answers and becomes the cached provider
    expect((await orch.chat({ messages: MESSAGES })).providerId).toBe('gemini');
    expect((await orch.pickProvider())?.config.id).toBe('gemini');
  });

  test('fallback switched off → only the first provider is tried', async () => {
    await ProviderSettings.setAdvanced({ fallback: false });
    const b = fakeProvider('openrouter');
    await expect(
      orchestratorWith(fakeProvider('gemini', ['server']), b).chat({ messages: MESSAGES }),
    ).rejects.toThrow(/ผู้ให้บริการทุกรายล้มเหลว/);
    expect(b.requests).toHaveLength(0);
  });

  test('retries the same provider on retryable errors before falling back', async () => {
    await ProviderSettings.setAdvanced({ retries: 1 });
    const a = fakeProvider('gemini', ['rate_limit', 'ok']);
    const b = fakeProvider('openrouter');
    const res = await orchestratorWith(a, b).chat({ messages: MESSAGES });
    expect(res.providerId).toBe('gemini');
    expect(a.requests).toHaveLength(2);
    expect(b.requests).toHaveLength(0);
  });

  test('auth errors are never retried, even with retries enabled', async () => {
    await ProviderSettings.setAdvanced({ retries: 2 });
    const a = fakeProvider('gemini', ['auth']);
    const res = await orchestratorWith(a, fakeProvider('openrouter')).chat({ messages: MESSAGES });
    expect(res.providerId).toBe('openrouter');
    expect(a.requests).toHaveLength(1);
  });

  test('timeout from Advanced settings is passed to every provider call', async () => {
    await ProviderSettings.setAdvanced({ timeoutMs: 12_000 });
    const a = fakeProvider('gemini');
    await orchestratorWith(a).chat({ messages: MESSAGES, temperature: 0.2 });
    // resetSettings() saved a model for gemini, so that wins over the config default
    expect(nth(a.requests, 0)).toMatchObject({
      timeoutMs: 12_000,
      temperature: 0.2,
      model: 'gemini-3-flash',
    });
  });
});

describe('AI Orchestrator — real adapters (Gemini → OpenRouter) over mocked HTTP', () => {
  test.each([401, 403, 429, 500, 503])('Gemini HTTP %i → OpenRouter', async (status) => {
    const { hosts } = mockFetch([
      [GEMINI, () => httpError(status)],
      [OPENROUTER, () => openRouterText('fallback ok')],
    ]);
    // Fresh orchestrator: the shared one would remember OpenRouter as last-good and skip Gemini
    const res = await new Orchestrator().chat({ messages: MESSAGES });
    expect(res).toMatchObject({ providerId: 'openrouter', content: 'fallback ok' });
    expect(hosts()).toEqual(['generativelanguage.googleapis.com', 'openrouter.ai']);
  });

  test("Gemini's 400 API_KEY_INVALID is treated as auth → OpenRouter", async () => {
    mockFetch([
      [
        GEMINI,
        () =>
          json(
            { error: { code: 400, message: 'API key not valid.', status: 'API_KEY_INVALID' } },
            400,
          ),
      ],
      [OPENROUTER, () => openRouterText('ok')],
    ]);
    await expect(new Orchestrator().chat({ messages: MESSAGES })).resolves.toMatchObject({
      providerId: 'openrouter',
    });
  });

  test('the shared aiOrchestrator keeps the last good provider across calls', async () => {
    const { hosts } = mockFetch([
      [GEMINI, () => httpError(503)],
      [OPENROUTER, () => openRouterText('ok')],
    ]);
    await aiOrchestrator.chat({ messages: MESSAGES });
    await aiOrchestrator.chat({ messages: MESSAGES });
    expect(hosts()).toEqual([
      'generativelanguage.googleapis.com',
      'openrouter.ai',
      'openrouter.ai',
    ]);
  });

  describe('lastGood sticky behaviour (429)', () => {
    test('Gemini 429 → OpenRouter; the next call goes to OpenRouter first, Gemini is skipped', async () => {
      const { hosts, calls } = mockFetch([
        [GEMINI, () => httpError(429, 'Resource has been exhausted')],
        [OPENROUTER, () => openRouterText('จาก OpenRouter')],
      ]);
      const orch = new Orchestrator();

      const first = await orch.chat({ messages: MESSAGES });
      expect(first.providerId).toBe('openrouter');
      // โควต้าหมด (exhausted) → ลองรุ่นสำรองของ Gemini ก่อน (ADR-017) แล้วค่อย OpenRouter
      expect(
        calls.filter((c) => GEMINI.test(c.url.href)).map((c) => c.url.pathname.split('/')[3]),
      ).toEqual([
        'gemini-3-flash:generateContent',
        'gemini-2.5-flash:generateContent',
        'gemini-2.5-flash-lite:generateContent',
      ]);
      expect(hosts().at(-1)).toBe('openrouter.ai');

      const second = await orch.chat({ messages: MESSAGES });
      expect(second.providerId).toBe('openrouter');
      expect(hosts().slice(4)).toEqual(['openrouter.ai']); // sticky: no Gemini attempt
      expect((await orch.pickProvider())?.config.id).toBe('openrouter');
    });

    test('sticky provider wins over the saved priority until it fails, then priority resumes', async () => {
      await ProviderSettings.setPriority(['gemini', 'openrouter']);
      let openRouterDown = false;
      const { hosts } = mockFetch([
        [GEMINI, () => (openRouterDown ? geminiText('Gemini กลับมาแล้ว') : httpError(429))],
        [OPENROUTER, () => (openRouterDown ? httpError(429) : openRouterText('ok'))],
      ]);
      const orch = new Orchestrator();
      await orch.chat({ messages: MESSAGES }); // gemini 429 → openrouter (sticky)
      await orch.chat({ messages: MESSAGES }); // openrouter first despite priority
      expect(hosts()).toEqual([
        'generativelanguage.googleapis.com',
        'openrouter.ai',
        'openrouter.ai',
      ]);

      openRouterDown = true;
      const res = await orch.chat({ messages: MESSAGES }); // sticky fails → back to priority order
      expect(res).toMatchObject({ providerId: 'gemini', content: 'Gemini กลับมาแล้ว' });
      expect(hosts().slice(3)).toEqual(['openrouter.ai', 'generativelanguage.googleapis.com']);
      expect((await orch.pickProvider())?.config.id).toBe('gemini'); // new sticky provider
    });

    test('a 429 retried successfully (retries=1) keeps the same provider sticky', async () => {
      await ProviderSettings.setAdvanced({ retries: 1 });
      let geminiCalls = 0;
      const { hosts } = mockFetch([
        [GEMINI, () => (++geminiCalls === 1 ? httpError(429) : geminiText('ok'))],
        [OPENROUTER, () => openRouterText('should not be used')],
      ]);
      const orch = new Orchestrator();
      await expect(orch.chat({ messages: MESSAGES })).resolves.toMatchObject({
        providerId: 'gemini',
      });
      expect(hosts()).toEqual([
        'generativelanguage.googleapis.com',
        'generativelanguage.googleapis.com',
      ]);
      expect((await orch.pickProvider())?.config.id).toBe('gemini');
    });
  });

  test('a genuine 400 (bad request) stops the chain', async () => {
    const { hosts } = mockFetch([[GEMINI, () => httpError(400, 'model not found')]]);
    await expect(new Orchestrator().chat({ messages: MESSAGES })).rejects.toMatchObject({
      kind: 'bad_request',
      status: 400,
    });
    expect(hosts()).toEqual(['generativelanguage.googleapis.com']);
  });

  test('missing Gemini key → straight to OpenRouter without calling Gemini', async () => {
    await setAIKeys(['openrouter']);
    const { hosts } = mockFetch([[OPENROUTER, () => openRouterText('ok')]]);
    await new Orchestrator().chat({ messages: MESSAGES });
    expect(hosts()).toEqual(['openrouter.ai']);
  });

  test('Gemini success parses text, tokens and model', async () => {
    mockFetch([[GEMINI, () => geminiText('สวัสดีครับ')]]);
    await expect(new Orchestrator().chat({ messages: MESSAGES })).resolves.toEqual({
      content: 'สวัสดีครับ',
      model: 'gemini-3-flash',
      providerId: 'gemini',
      tokensUsed: { input: 11, output: 7 },
    });
  });

  test('request timeout (Advanced) aborts the call and falls back', async () => {
    await ProviderSettings.setAdvanced({ timeoutMs: 50 });
    const hang = hangingFetch();
    hang.mockImplementation(async (input, init) => {
      if (String(input).includes('openrouter')) return openRouterText('after timeout');
      return new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    await expect(new Orchestrator().chat({ messages: MESSAGES })).resolves.toMatchObject({
      providerId: 'openrouter',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Voice auto-switch
// ---------------------------------------------------------------------------------------------

type VoiceStep = 'ok' | ProviderErrorKind;

function fakeTTS(id: TTSProviderId, step: VoiceStep = 'ok') {
  const spoken: { text: string; opts: unknown }[] = [];
  const tts: TTSProvider & { spoken: typeof spoken } = {
    id,
    name: id,
    spoken,
    speak: async (text, opts) => {
      spoken.push({ text, opts });
      if (step !== 'ok') throw new ProviderError(id, step, `${step}`);
    },
    stop: jest.fn(),
    getVoices: async () => [],
    testConnection: async () => ({ ok: true }),
  };
  return tts;
}

function fakeSTT(id: STTProviderId, step: VoiceStep = 'ok') {
  const stt: STTProvider & { calls: number } = {
    id,
    name: id,
    calls: 0,
    transcribe: async () => {
      stt.calls++;
      if (step !== 'ok') throw new ProviderError(id, step, `${step}`);
      return `text from ${id}`;
    },
    testConnection: async () => ({ ok: true }),
  };
  return stt;
}

function voiceWith(tts: TTSProvider[], stt: STTProvider[] = []) {
  const registry = new VoiceRegistry();
  tts.forEach((p) => registry.registerTTS(p));
  stt.forEach((p) => registry.registerSTT(p));
  return new VoiceOrchestrator(registry);
}

describe('Voice Orchestrator — TTS priority + fallback', () => {
  test('persona voice provider first, with its voice/speed/pitch', async () => {
    await ProviderSettings.setTTSFor(1, {
      providerId: 'openai',
      voiceId: 'nova',
      speed: 1.2,
      pitch: 0.9,
    });
    const expo = fakeTTS('expo');
    const openai = fakeTTS('openai');
    await voiceWith([expo, openai]).speak('hi', 1);
    expect(openai.spoken).toEqual([
      { text: 'hi', opts: { voiceId: 'nova', speed: 1.2, pitch: 0.9 } },
    ]);
    expect(expo.spoken).toHaveLength(0);
  });

  test('คำตอบหลายประโยค: เจ้าเดิมพูดครบทุกประโยคตามลำดับ (Voice A — พูดทีละประโยค)', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'openai' });
    const text = 'สวัสดีครับบอส พร้อมแล้วนะ. จะเริ่มเลยนะครับ. ขอบคุณครับ';
    const chunks = splitSentences(text);
    expect(chunks.length).toBeGreaterThan(1); // ต้องถูกแบ่งจริง ไม่งั้นเทสนี้ไม่มีความหมาย
    const openai = fakeTTS('openai');
    const expo = fakeTTS('expo');
    await voiceWith([openai, expo]).speak(text, 1);
    expect(openai.spoken.map((s) => s.text)).toEqual(chunks);
    expect(expo.spoken).toHaveLength(0); // เจ้าแรกพูดได้หมด ไม่ต้อง fallback
  });

  test('คำตอบหลายประโยค: เจ้าเดิมล้มประโยคที่สอง → ตกไป Expo พูดประโยคนั้น (ไม่พูดค้างครึ่งคำตอบ)', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'openai' });
    const text = 'สวัสดีครับบอส พร้อมแล้วนะ. จะเริ่มเลยนะครับ. ขอบคุณครับ';
    const chunks = splitSentences(text);
    const openai = fakeTTS('openai');
    let calls = 0;
    openai.speak = async (t, opts) => {
      openai.spoken.push({ text: t, opts });
      if (++calls >= 2) throw new ProviderError('openai', 'server', 'boom'); // ล้มตั้งแต่ประโยคที่สอง
    };
    const expo = fakeTTS('expo');
    await voiceWith([openai, expo]).speak(text, 1);
    expect(openai.spoken.map((s) => s.text)).toEqual(chunks); // พยายามทุกประโยค
    // ประโยคที่ openai ล้ม Expo พูดแทนครบ (ไม่เงียบหาย)
    expect(expo.spoken.map((s) => s.text)).toEqual(chunks.slice(1));
  });

  test('persona provider fails → TTS priority list → fallback uses its own default voice', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'openai', voiceId: 'nova', speed: 1.2 });
    await ProviderSettings.setVoicePriority('tts', ['elevenlabs', 'expo']);
    await ProviderSettings.setOption('tts.elevenlabs', 'voiceId', 'rachel');
    const openai = fakeTTS('openai', 'auth');
    const eleven = fakeTTS('elevenlabs');
    await voiceWith([fakeTTS('expo'), openai, eleven]).speak('hi', 1);
    expect(nth(eleven.spoken, 0).opts).toEqual({ voiceId: 'rachel', speed: 1.2, pitch: undefined });
  });

  test('disabled providers are skipped; Expo stays the last resort even when disabled', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'google' });
    await ProviderSettings.setVoiceEnabled('tts', 'google', false);
    await ProviderSettings.setVoiceEnabled('tts', 'expo', false);
    const google = fakeTTS('google');
    const azure = fakeTTS('azure', 'server');
    const expo = fakeTTS('expo');
    await voiceWith([google, azure, expo]).speak('hi', 1);
    expect(google.spoken).toHaveLength(0);
    expect(azure.spoken).toHaveLength(1);
    expect(expo.spoken).toHaveLength(1);
  });

  test('non-fallback error stops the chain; all failing → aggregated error', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'openai' });
    const expo = fakeTTS('expo');
    await expect(
      voiceWith([fakeTTS('openai', 'bad_request'), expo]).speak('hi', 1),
    ).rejects.toMatchObject({
      kind: 'bad_request',
    });
    expect(expo.spoken).toHaveLength(0);

    await expect(
      voiceWith([fakeTTS('openai', 'server'), fakeTTS('expo', 'unsupported')]).speak('hi', 1),
    ).rejects.toThrow(/ผู้ให้บริการเสียงทุกรายล้มเหลว/);
    await expect(voiceWith([]).speak('hi', 1)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  test('stop() stops the provider that is currently speaking', async () => {
    let release!: () => void;
    const slow = fakeTTS('expo');
    slow.speak = () => new Promise<void>((r) => (release = r));
    const voice = voiceWith([slow]);
    const pending = voice.speak('long text', 1);
    await new Promise((r) => setTimeout(r, 0));
    voice.stop();
    expect(slow.stop).toHaveBeenCalled();
    release();
    await pending;
  });
});

describe('Voice Orchestrator — STT priority + fallback', () => {
  test('chosen STT → priority list → remaining enabled providers', async () => {
    await ProviderSettings.setSTT('deepgram');
    await ProviderSettings.setVoicePriority('stt', ['assemblyai', 'whisper']);
    await ProviderSettings.setVoiceEnabled('stt', 'assemblyai', false);
    const deepgram = fakeSTT('deepgram', 'rate_limit');
    const assembly = fakeSTT('assemblyai');
    const whisper = fakeSTT('whisper');
    const text = await voiceWith(
      [],
      [fakeSTT('expo', 'unsupported'), deepgram, assembly, whisper],
    ).listen('file:///rec.m4a');
    expect(text).toBe('text from whisper');
    expect(deepgram.calls).toBe(1);
    expect(assembly.calls).toBe(0);
  });

  test('every STT disabled → no provider error', async () => {
    await ProviderSettings.setVoiceEnabled('stt', 'whisper', false);
    await expect(voiceWith([], [fakeSTT('whisper')]).listen('x')).rejects.toMatchObject({
      kind: 'unsupported',
    });
  });
});

describe('Secret storage used by the chain', () => {
  test('keys live in SecureStore under the provider scope', async () => {
    expect(await SecureKeyStore.has(secretKey('ai', 'gemini'))).toBe(true);
    await setAIKeys([]);
    expect(await SecureKeyStore.has(secretKey('ai', 'gemini'))).toBe(false);
    expect(() => secretKey('ai', 'gemini', 'bad key!')).not.toThrow();
    await expect(SecureKeyStore.set('bad key!', 'x')).rejects.toThrow(/Invalid secure key name/);
  });
});
