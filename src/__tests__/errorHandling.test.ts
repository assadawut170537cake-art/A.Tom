import { createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as Network from 'expo-network';
import * as Speech from 'expo-speech';

import { ProviderError, commonKind, redactSecrets, userAdvice } from '../core/http/errors';
import { request } from '../core/http/request';
import { isOffline } from '../core/network/connectivity';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { IntentRouter } from '../features/router/core/IntentRouter';
import type { Classifier, RouterOutput } from '../features/router/core/types';
import { ensureMicPermission } from '../features/voice/core/permissions';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import {
  GEMINI,
  JEV,
  OPENROUTER,
  geminiText,
  httpError,
  isClassifierCall,
  jevChoice,
  json,
  mockFetch,
  openRouterText,
} from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter', 'jev']);
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  resetStore();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const MESSAGES = [{ role: 'user' as const, content: 'สวัสดี' }];
const history = () => useAtomStore.getState().messagesByPersona[1];
const lastSystem = () => history().filter((m) => m.role === 'system').at(-1)?.content ?? '';
const offline = { type: 'NONE', isConnected: false, isInternetReachable: false } as never;

describe('B1 — API keys are redacted from error text', () => {
  test('sk-… and AIza… keys become [REDACTED]; ordinary words are untouched', () => {
    expect(redactSecrets('bad key sk-or-v1-abc_DEF-123 and AIzaSyA1b2-C3_d4 here')).toBe(
      'bad key [REDACTED] and [REDACTED] here'
    );
    expect(redactSecrets('task-runner risk-free sk-')).toBe('task-runner risk-free sk-');
  });

  test('AWS access key ids (AKIA + 16) are redacted; look-alikes are not', () => {
    expect(redactSecrets('Credential=AKIAIOSFODNN7EXAMPLE/20150830/us-east-1/polly/aws4_request')).toBe(
      'Credential=[REDACTED]/20150830/us-east-1/polly/aws4_request'
    );
    expect(redactSecrets('key AKIAIOSFODNN7EXAMPLE')).toBe('key [REDACTED]');
    expect(redactSecrets('AKIA123 · akiaiosfodnn7example · XAKIAIOSFODNN7EXAMPLE')).toBe(
      'AKIA123 · akiaiosfodnn7example · XAKIAIOSFODNN7EXAMPLE'
    );
  });

  test('Polly SigV4 errors echoing the access key id are redacted end to end', async () => {
    mockFetch([
      [/polly/, () => json({ message: 'The request signature we calculated does not match. Credential=AKIAIOSFODNN7EXAMPLE/20150830' }, 403)],
    ]);
    const err = (await request('polly', 'https://polly.us-east-1.amazonaws.com/v1/voices').catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('Credential=[REDACTED]/20150830');
    expect(err.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  test('provider error bodies echoing the key are redacted before they reach the message', async () => {
    mockFetch([
      [/a\.test/, () => httpError(401, 'Incorrect API key provided: sk-proj-SECRET123')],
      [/b\.test/, () => json({ error: { message: 'API key not valid. key=AIzaSECRET456' } }, 400)],
    ]);
    const a = await request('openai', 'https://a.test').catch((e: unknown) => e);
    const b = await request('gemini', 'https://b.test').catch((e: unknown) => e);
    expect(a).toMatchObject({ kind: 'auth', message: expect.stringContaining('provided: [REDACTED]') });
    expect(String((a as Error).message)).not.toContain('SECRET123');
    expect(b).toMatchObject({ kind: 'auth' });
    expect(String((b as Error).message)).toContain('key=[REDACTED]');
  });

  test('a key longer than the 200-char excerpt is redacted before truncating', async () => {
    mockFetch([[/a\.test/, () => httpError(500, `${'x'.repeat(190)} sk-${'k'.repeat(40)}`)]]);
    const err = (await request('openai', 'https://a.test').catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/\[REDACT/); // the marker itself may be cut, the key never shows
    expect(err.message).not.toMatch(/sk-k/);
  });

  test('network failures get a Thai message (with the cause redacted)', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed for AIzaLEAKED'));
    await expect(request('gemini', 'https://a.test')).rejects.toMatchObject({
      kind: 'network',
      message: '[gemini] เชื่อมต่อเครือข่ายไม่ได้ (failed for [REDACTED])',
    });
  });

  test('conversation system messages (persisted to history) never contain a key', async () => {
    mockFetch([
      [GEMINI, () => httpError(500, 'boom for AIzaGEMINIKEY')],
      [OPENROUTER, () => httpError(502, 'upstream rejected sk-or-v1-ORKEY')],
    ]);
    const res = await sendMessage('ช่วยหน่อย', { speak: false });
    expect(res.error).not.toMatch(/GEMINIKEY|ORKEY/);
    expect(lastSystem()).not.toMatch(/GEMINIKEY|ORKEY/);
    expect(lastSystem()).toContain('[REDACTED]');
  });
});

describe('C1 — LLM errors: Thai messages, retry rules, fallback chain', () => {
  test('every error kind has Thai advice for the user', () => {
    const kinds = [
      'auth', 'rate_limit', 'server', 'timeout', 'network', 'bad_request',
      'missing_key', 'unsupported', 'invalid_response', 'permission',
    ] as const;
    for (const k of kinds) expect(userAdvice(k)).toMatch(/[ก-๙]/);
  });

  test('401 → not retried, falls back, and the rejected key is kept as a notice (once)', async () => {
    await ProviderSettings.setAdvanced({ timeoutMs: 30_000, retries: 3, fallback: true });
    const { calls } = mockFetch([
      [GEMINI, () => httpError(401, 'bad key')],
      [OPENROUTER, () => openRouterText('สวัสดีครับ')],
    ]);
    const orch = new Orchestrator();
    const res = await orch.chat({ messages: MESSAGES });
    expect(res).toMatchObject({ providerId: 'openrouter', content: 'สวัสดีครับ' });
    expect(calls.filter((c) => GEMINI.test(c.url.href))).toHaveLength(1);
    const notices = orch.takeNotices();
    expect(notices).toEqual([expect.stringContaining('ตรวจสอบได้ที่ ตั้งค่า › AI')]);
    expect(nth(notices, 0)).toContain('[gemini] HTTP 401');
    expect(orch.takeNotices()).toEqual([]);
  });

  test('403 with fallback off → thrown as auth (no retry, nothing else tried)', async () => {
    await ProviderSettings.setAdvanced({ timeoutMs: 30_000, retries: 2, fallback: false });
    const { calls } = mockFetch([[GEMINI, () => httpError(403)], [OPENROUTER, () => openRouterText('x')]]);
    await expect(new Orchestrator().chat({ messages: MESSAGES })).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  test('429 and 5xx are retried, then the chain falls back', async () => {
    await ProviderSettings.setAdvanced({ timeoutMs: 30_000, retries: 1, fallback: true });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const { calls } = mockFetch([
        [GEMINI, () => httpError(429)],
        [OPENROUTER, () => openRouterText('ok')],
      ]);
      const pending = new Orchestrator().chat({ messages: MESSAGES });
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toMatchObject({ providerId: 'openrouter' });
      expect(calls.map((c) => c.url.host)).toEqual([
        'generativelanguage.googleapis.com',
        'generativelanguage.googleapis.com',
        'openrouter.ai',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('non-auth failures before a success leave no notices', async () => {
    mockFetch([[GEMINI, () => httpError(503)], [OPENROUTER, () => openRouterText('ok')]]);
    const orch = new Orchestrator();
    await orch.chat({ messages: MESSAGES });
    expect(orch.takeNotices()).toEqual([]);
  });

  test('aggregated failure keeps the shared kind (all offline → network), else server', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    await expect(new Orchestrator().chat({ messages: MESSAGES })).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('ผู้ให้บริการทุกรายล้มเหลว'),
    });
    const e = (kind: 'auth' | 'server') => new ProviderError('x', kind, kind);
    expect(commonKind([e('auth'), e('auth')])).toBe('auth');
    expect(commonKind([e('auth'), e('server')])).toBe('server');
    expect(commonKind([])).toBe('server');
  });

  test('conversation shows the auth notice as a system message after the reply', async () => {
    mockFetch([
      [GEMINI, () => httpError(401, 'bad key')],
      [OPENROUTER, (c) => (isClassifierCall(c) ? openRouterText('{"intent":"chat"}') : openRouterText('ตอบแล้ว'))],
    ]);
    const res = await sendMessage('สวัสดี', { speak: false });
    expect(res.reply).toBe('ตอบแล้ว');
    expect(history().map((m) => m.role)).toEqual(['user', 'assistant', 'system']);
    expect(lastSystem()).toMatch(/^⚠️ \[gemini\] HTTP 401.*ตั้งค่า › AI$/s);
  });

  test('conversation error message: Thai advice first, technical detail below; mood back to idle', async () => {
    mockFetch([[GEMINI, () => httpError(500)], [OPENROUTER, () => httpError(503)]]);
    await sendMessage('ช่วยหน่อย', { speak: false });
    expect(lastSystem().split('\n')[0]).toBe(`⚠️ ${userAdvice('server')}`);
    expect(lastSystem()).toContain('ผู้ให้บริการทุกรายล้มเหลว');
    expect(useAtomStore.getState().mood).toBe('idle');
  });
});

describe('C2 — Jev → Gemini fallback', () => {
  test('Jev switched off → Gemini classifies, Jev is never called', async () => {
    await ProviderSettings.setEnabled('jev', false);
    const { hosts } = mockFetch([
      [JEV, () => jevChoice('chat', 0.99)],
      [GEMINI, () => geminiText('{"intent":"chat","confidence":0.9}')],
    ]);
    const out = await new IntentRouter().route({ text: 'เช็กเครื่องให้หน่อย' }); // มีคำใบ้คำสั่ง → ถาม LLM
    expect(out).toEqual({ intent: 'chat', confidence: 0.9, provider: 'llm' });
    expect(hosts()).toEqual(['generativelanguage.googleapis.com']);
  });

  test('Jev enabled but its key is rejected (401) → Gemini classifies', async () => {
    await ProviderSettings.setEnabled('jev', true);
    const { hosts } = mockFetch([
      [JEV, () => httpError(401)],
      [GEMINI, () => geminiText('{"intent":"pc_command","confidence":0.8}')],
    ]);
    const out = await new IntentRouter().route({ text: 'ช่วยจัดการเครื่องให้หน่อย' });
    expect(out.provider).toBe('llm');
    expect(out.intent).toBe('pc_command');
    expect(hosts()).toEqual(['api.typesafe.ai', 'generativelanguage.googleapis.com']);
  });

  test('Jev enabled without a key → Gemini classifies without calling Jev', async () => {
    await ProviderSettings.setEnabled('jev', true);
    await setAIKeys(['gemini', 'openrouter']);
    const { hosts } = mockFetch([[GEMINI, () => geminiText('{"intent":"chat","confidence":0.9}')]]);
    expect((await new IntentRouter().route({ text: 'อืม เครื่องช้าจัง' })).provider).toBe('llm');
    expect(hosts()).toEqual(['generativelanguage.googleapis.com']);
  });
});

describe('C3 — voice errors', () => {
  test('microphone already granted → no prompt', async () => {
    await expect(voiceOrchestrator.requestMicrophone()).resolves.toBeUndefined();
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  test('undetermined → asks once; granted → ok', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    await expect(ensureMicPermission()).resolves.toBeUndefined();
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('denied → Thai permission error (no fallback)', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    const err = (await ensureMicPermission().catch((e: unknown) => e)) as ProviderError;
    expect(err).toMatchObject({ kind: 'permission', message: '[voice] ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน' });
    expect(err.shouldFallback).toBe(false);
  });

  test('permanently denied → tells the user where to enable it, without prompting', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await expect(ensureMicPermission()).rejects.toMatchObject({
      kind: 'permission',
      message: expect.stringContaining('ตั้งค่าเครื่อง › แอป › A.T.O.M. › ไมโครโฟน'),
    });
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  test('permission API itself failing → permission error + console.error, never a crash', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockRejectedValueOnce(new Error('native module missing'));
    await expect(ensureMicPermission()).rejects.toMatchObject({ kind: 'permission' });
    expect(console.error).toHaveBeenCalled();
  });

  test('cloud TTS playback fails → falls back to on-device Expo Speech', async () => {
    await SecureKeyStore.set(secretKey('tts', 'openai'), 'k');
    await ProviderSettings.setTTSFor(1, { providerId: 'openai' });
    mockFetch([[/openai/, () => new Response(new Uint8Array([1, 2, 3]))]]);
    jest.mocked(createAudioPlayer).mockImplementationOnce(
      () =>
        ({
          addListener: () => ({ remove: jest.fn() }),
          play: () => {
            throw new Error('audio focus lost');
          },
          pause: jest.fn(),
          remove: jest.fn(),
        }) as never
    );
    await voiceOrchestrator.speak('สวัสดี', 1);
    expect(Speech.speak).toHaveBeenCalledWith('สวัสดี', expect.anything());
  });

  test('every TTS fails → one aggregated Thai error (no hang, no crash)', async () => {
    await SecureKeyStore.delete(secretKey('tts', 'openai'));
    // Gemini TTS shares the Gemini LLM key set in beforeEach — make its call fail too (hermetic, no real network)
    mockFetch([[GEMINI, () => httpError(503)]]);
    jest.mocked(Speech.speak).mockImplementationOnce((_t, opts) => {
      (opts?.onError as ((e: Error) => void) | undefined)?.(new Error('engine busy'));
    });
    await expect(voiceOrchestrator.speak('x', 1)).rejects.toMatchObject({
      message: expect.stringContaining('ผู้ให้บริการเสียงทุกรายล้มเหลว'),
    });
  });

  test('STT: every provider offline → network error with Thai summary', async () => {
    for (const id of ['whisper', 'deepgram'] as const) await SecureKeyStore.set(secretKey('stt', id), 'k');
    for (const id of ['google', 'azure', 'assemblyai', 'revai', 'custom'] as const) {
      await ProviderSettings.setVoiceEnabled('stt', id, false);
    }
    await ProviderSettings.setVoiceEnabled('stt', 'expo', false);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    await expect(voiceOrchestrator.listen('file:///cache/rec.m4a')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringMatching(/ผู้ให้บริการเสียงทุกรายล้มเหลว[\s\S]*whisper[\s\S]*deepgram/),
    });
  });

  test('STT: missing recording → bad_request, chain stops (other providers would fail too)', async () => {
    await SecureKeyStore.set(secretKey('stt', 'whisper'), 'k');
    await ProviderSettings.setSTT('whisper');
    const { spy } = mockFetch([]);
    await expect(voiceOrchestrator.listen('file:///cache/missing.m4a')).rejects.toMatchObject({
      kind: 'bad_request',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('C5 — network offline', () => {
  test('isOffline reads expo-network; unknown state counts as online', async () => {
    await expect(isOffline()).resolves.toBe(false);
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce(offline);
    await expect(isOffline()).resolves.toBe(true);
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ isConnected: true, isInternetReachable: false } as never);
    await expect(isOffline()).resolves.toBe(true);
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({} as never);
    await expect(isOffline()).resolves.toBe(false);
  });

  test('isOffline never throws: a failing check logs and assumes online', async () => {
    jest.mocked(Network.getNetworkStateAsync).mockRejectedValueOnce(new Error('no native module'));
    await expect(isOffline()).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith('[network] ตรวจสอบสถานะเครือข่ายไม่ได้', expect.any(Error));
  });

  test('requests fail with network errors → the user is told they are offline', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const res = await sendMessage('ฮัลโหล', { speak: false });
    expect(res.error).toMatch(/เชื่อมต่อเครือข่ายไม่ได้/);
    expect(lastSystem().split('\n')[0]).toBe(`⚠️ ${userAdvice('network')}`);
  });

  test('device reports offline (requests timed out) → offline advice instead of "server down"', async () => {
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce(offline);
    mockFetch([[GEMINI, () => httpError(504)], [OPENROUTER, () => httpError(504)]]);
    await sendMessage('ฮัลโหล', { speak: false });
    expect(lastSystem().split('\n')[0]).toBe(`⚠️ ${userAdvice('network')}`);
  });
});

describe('C6 — unknown intents fall back to chat', () => {
  const stub = (out: RouterOutput | null): Classifier => ({ classify: async () => out });

  test('Jev answers an intent outside the list → ignored; LLM gibberish → default chat', async () => {
    await ProviderSettings.setEnabled('jev', true);
    mockFetch([
      [JEV, () => jevChoice('play_music', 0.99)],
      [GEMINI, () => geminiText('{"intent":"order_pizza","confidence":0.95}')],
    ]);
    await expect(new IntentRouter().route({ text: 'เปิดเพลงหน่อย' })).resolves.toEqual({
      intent: 'chat',
      confidence: 0.5,
      provider: 'rule',
    });
  });

  test('handle(): an unknown intent is answered by the chat handler', async () => {
    const chat = { handle: jest.fn(async () => ({ reply: 'คุยกันได้ครับ', persona: 1 as const })) };
    const router = new IntentRouter({ jev: stub(null), llm: stub(null), handlers: { chat } });
    const { route, result } = await router.handle({ text: 'ทำอะไรแปลกๆ ให้หน่อย' });
    expect(route.intent).toBe('chat');
    expect(result.reply).toBe('คุยกันได้ครับ');
    expect(chat.handle).toHaveBeenCalledTimes(1);
  });

  test('end to end: an unknown label from the LLM still produces a chat reply', async () => {
    mockFetch([
      [GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"weather"}') : geminiText('วันนี้อากาศดีครับ'))],
    ]);
    const res = await sendMessage('อากาศเป็นไง', { speak: false });
    expect(res.route?.intent).toBe('chat');
    expect(res.reply).toBe('วันนี้อากาศดีครับ');
  });
});
