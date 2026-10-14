/// <reference types="node" />
import { createAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { voiceRegistry } from '../features/voice/core/VoiceRegistry';
import { decodeBase64, pcmFormatFromMime, pcmToWav } from '../features/voice/core/wav';
import {
  GEMINI_TTS_DEFAULT_MODEL,
  GEMINI_TTS_DEFAULT_VOICE,
  GEMINI_TTS_VOICES,
} from '../features/voice/tts/GeminiTTS';
import { TTS_PROVIDERS, VOICE_PROVIDER_FIELDS } from '../features/voice/voice.config';
import { GEMINI, httpError, json, mockFetch, type RecordedCall } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings } from '../test-utils/setup';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await SecureKeyStore.delete(secretKey('tts', 'gemini'));
  await SecureKeyStore.set(secretKey('ai', 'gemini'), 'llm-key');
  await ProviderSettings.setOption('tts.gemini', 'model', '');
  jest.clearAllMocks();
  autoFinishingPlayer();
});

afterEach(() => jest.restoreAllMocks());

const gemini = () => {
  const tts = voiceRegistry.getTTS('gemini');
  if (!tts) throw new Error('Gemini TTS is not registered');
  return tts;
};

function autoFinishingPlayer() {
  jest.mocked(createAudioPlayer).mockImplementation(() => {
    const listeners: ((s: { didJustFinish: boolean }) => void)[] = [];
    return {
      addListener: (_e: string, fn: (s: { didJustFinish: boolean }) => void) => {
        listeners.push(fn);
        return { remove: jest.fn() };
      },
      play: () => listeners.forEach((fn) => fn({ didJustFinish: true })),
      pause: jest.fn(),
      remove: jest.fn(),
    } as never;
  });
}

/** 4 PCM samples (16-bit LE): 0, 1, -1, 32767 */
const PCM = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0xff, 0xff, 0xff, 0x7f]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const audioResponse = (mimeType: string, data: string) =>
  json({
    candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType, data } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5 },
  });

const ttsRoute = (respond: (c: RecordedCall) => Response) =>
  [GEMINI, respond] as [RegExp, (c: RecordedCall) => Response];

describe('Gemini TTS — synthesize()', () => {
  test('POSTs generateContent with AUDIO modality, the voice and th-TH, using the Gemini LLM key', async () => {
    const { calls } = mockFetch([ttsRoute(() => audioResponse('audio/wav', b64(pcmToWav(PCM, pcmFormatFromMime('')))))]);
    await gemini().speak('สวัสดีครับบอส', { voiceId: 'Puck', speed: 1.3, pitch: 0.8 });

    const call = nth(calls, 0);
    expect(call.method).toBe('POST');
    expect(call.url.href).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_DEFAULT_MODEL}:generateContent`
    );
    expect(call.headers['x-goog-api-key']).toBe('llm-key');
    expect(call.url.search).toBe(''); // key never in the URL
    expect(call.body).toEqual({
      contents: [{ parts: [{ text: 'สวัสดีครับบอส' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          languageCode: 'th-TH',
        },
      },
    }); // speed/pitch have no numeric equivalent in Gemini TTS → not sent
  });

  test('no voice chosen → default voice; custom model option is used', async () => {
    await ProviderSettings.setOption('tts.gemini', 'model', ' gemini-2.5-flash-preview-tts ');
    const { calls } = mockFetch([ttsRoute(() => audioResponse('audio/wav', 'UklGRg=='))]);
    await gemini().speak('ทดสอบ');
    expect(nth(calls, 0).url.pathname).toBe('/v1beta/models/gemini-2.5-flash-preview-tts:generateContent');
    expect(JSON.stringify(nth(calls, 0).body)).toContain(`"voiceName":"${GEMINI_TTS_DEFAULT_VOICE}"`);
  });

  test('audio/wav (Gemini 3.8) is played as-is from a .wav file', async () => {
    const write = jest.spyOn(File.prototype, 'write');
    mockFetch([ttsRoute(() => audioResponse('audio/wav', 'UklGRiQAAABXQVZF'))]);
    await gemini().speak('ทดสอบ');
    expect(write).toHaveBeenCalledWith('UklGRiQAAABXQVZF', { encoding: 'base64' });
    expect(createAudioPlayer).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/tts-gemini-\d+\.wav$/));
  });

  test('raw PCM audio/L16 (Gemini 2.5 / 3.1) is wrapped in a WAV header with the given rate', async () => {
    const write = jest.spyOn(File.prototype, 'write');
    mockFetch([ttsRoute(() => audioResponse('audio/L16;codec=pcm;rate=24000', b64(PCM)))]);
    await gemini().speak('ทดสอบ');

    const wav = nth(write.mock.calls, 0)[0] as unknown as Uint8Array; // the provider writes bytes for PCM
    expect(wav).toBeInstanceOf(Uint8Array);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + PCM.length);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000); // byte rate
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(PCM.length);
    expect([...wav.subarray(44)]).toEqual([...PCM]);
    expect(createAudioPlayer).toHaveBeenCalledWith(expect.stringMatching(/\.wav$/));
  });

  test('mp3 responses keep their format', async () => {
    mockFetch([ttsRoute(() => audioResponse('audio/mpeg', 'SUQz'))]);
    await gemini().speak('ทดสอบ');
    expect(createAudioPlayer).toHaveBeenCalledWith(expect.stringMatching(/\.mp3$/));
  });
});

describe('Gemini TTS — keys and errors', () => {
  test('a TTS-specific key (tts.gemini) wins over the shared LLM key', async () => {
    await SecureKeyStore.set(secretKey('tts', 'gemini'), 'tts-only-key');
    const { calls } = mockFetch([ttsRoute(() => audioResponse('audio/wav', 'UklGRg=='))]);
    await gemini().speak('ทดสอบ');
    expect(nth(calls, 0).headers['x-goog-api-key']).toBe('tts-only-key');
  });

  test('no key anywhere → missing_key in Thai pointing to AI settings, no request', async () => {
    await SecureKeyStore.delete(secretKey('ai', 'gemini'));
    const { spy } = mockFetch([]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({
      kind: 'missing_key',
      message: '[gemini] ยังไม่ได้ตั้งค่า API key — ใช้ key เดียวกับ Gemini ได้ที่ ตั้งค่า › AI Providers',
    });
    await expect(gemini().testConnection()).resolves.toMatchObject({ ok: false });
    expect(spy).not.toHaveBeenCalled();
  });

  test('401 / API_KEY_INVALID → auth (falls back); 503 → server (falls back)', async () => {
    mockFetch([ttsRoute(() => httpError(401, 'bad key'))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({ kind: 'auth', shouldFallback: true });

    jest.restoreAllMocks();
    autoFinishingPlayer();
    mockFetch([ttsRoute(() => json({ error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, 400))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({ kind: 'auth' });

    jest.restoreAllMocks();
    autoFinishingPlayer();
    mockFetch([ttsRoute(() => httpError(503))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({ kind: 'server', shouldFallback: true });
  });

  test('blocked prompt / no audio part → invalid_response with the reason', async () => {
    mockFetch([ttsRoute(() => json({ promptFeedback: { blockReason: 'SAFETY' } }))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({
      kind: 'invalid_response',
      message: '[gemini] ไม่มีเสียงในคำตอบ (SAFETY)',
    });

    jest.restoreAllMocks();
    autoFinishingPlayer();
    mockFetch([ttsRoute(() => json({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'OTHER' }] }))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({ message: '[gemini] ไม่มีเสียงในคำตอบ (OTHER)' });

    jest.restoreAllMocks();
    autoFinishingPlayer();
    mockFetch([ttsRoute(() => json({}))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({ message: '[gemini] ไม่มีเสียงในคำตอบ' });
  });

  test('unknown audio format → invalid_response (no file is played)', async () => {
    mockFetch([ttsRoute(() => audioResponse('audio/x-unknown', 'AAAA'))]);
    await expect(gemini().speak('ทดสอบ')).rejects.toMatchObject({
      kind: 'invalid_response',
      message: '[gemini] รูปแบบเสียงไม่รองรับ (audio/x-unknown)',
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });
});

describe('Gemini TTS — voices, connection test, registration', () => {
  test('getVoices returns the 30 prebuilt voices with Thai + English style labels', async () => {
    const voices = await gemini().getVoices();
    expect(voices).toHaveLength(30);
    expect(new Set(voices.map((v) => v.id)).size).toBe(30);
    for (const name of ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Sulafat']) {
      expect(voices.map((v) => v.id)).toContain(name);
    }
    expect(voices.find((v) => v.id === 'Kore')?.name).toBe('Kore — หนักแน่น (Firm)');
    expect(voices.map((v) => v.id)).toContain(GEMINI_TTS_DEFAULT_VOICE);
    voices.pop(); // callers get a copy
    expect(GEMINI_TTS_VOICES).toHaveLength(30);
  });

  test('testConnection GETs the model (key + model check, no synthesis cost)', async () => {
    const { calls } = mockFetch([ttsRoute(() => json({ name: `models/${GEMINI_TTS_DEFAULT_MODEL}` }))]);
    await expect(gemini().testConnection()).resolves.toEqual({ ok: true });
    expect(nth(calls, 0).method).toBe('GET');
    expect(nth(calls, 0).url.href).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_DEFAULT_MODEL}`);
    expect(nth(calls, 0).headers['x-goog-api-key']).toBe('llm-key');
  });

  test('testConnection reports a wrong model name / bad key in Thai', async () => {
    mockFetch([ttsRoute(() => httpError(404, 'models/nope is not found'))]);
    await expect(gemini().testConnection()).resolves.toEqual({
      ok: false,
      error: '[gemini] HTTP 404: คำขอไม่ถูกต้อง — models/nope is not found',
    });
    jest.restoreAllMocks();
    mockFetch([ttsRoute(() => httpError(403))]);
    await expect(gemini().testConnection()).resolves.toMatchObject({
      error: expect.stringContaining('API key ไม่ถูกต้องหรือไม่มีสิทธิ์'),
    });
  });

  test('registered right after Expo Speech, needs a key, exposes a Model option', () => {
    expect(TTS_PROVIDERS.map((p) => p.id).slice(0, 2)).toEqual(['expo', 'gemini']);
    expect(TTS_PROVIDERS.find((p) => p.id === 'gemini')).toMatchObject({ name: 'Gemini TTS', requiresKey: true });
    expect(VOICE_PROVIDER_FIELDS.tts.gemini).toEqual({ secrets: [], options: ['model'] });
    expect(gemini().name).toBe('Gemini TTS');
  });

  test('enabled by default and used as the first cloud fallback after Expo Speech fails', async () => {
    expect(await ProviderSettings.getVoiceEnabled('tts', 'gemini')).toBe(true);
    await ProviderSettings.setTTSFor(1, { providerId: 'expo' });
    jest.mocked(Speech.speak).mockImplementationOnce((_t, opts) => {
      (opts?.onError as ((e: Error) => void) | undefined)?.(new Error('no Thai voice on device'));
    });
    const { calls } = mockFetch([ttsRoute(() => audioResponse('audio/wav', 'UklGRg=='))]);
    await voiceOrchestrator.speak('สวัสดี', 1);
    expect(calls.map((c) => c.url.pathname)).toEqual([`/v1beta/models/${GEMINI_TTS_DEFAULT_MODEL}:generateContent`]);
    expect(createAudioPlayer).toHaveBeenCalledWith(expect.stringMatching(/tts-gemini-\d+\.wav$/));
  });
});

describe('wav helpers', () => {
  test('decodeBase64 matches Buffer for every length and accepts URL-safe / unpadded input', () => {
    for (let n = 0; n < 64; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect([...decodeBase64(b64(bytes))]).toEqual([...bytes]);
    }
    const tricky = new Uint8Array([0xfb, 0xff, 0xbf, 0x3e]);
    const urlSafe = Buffer.from(tricky).toString('base64url'); // "-_-_Pg" style, no padding
    expect([...decodeBase64(urlSafe)]).toEqual([...tricky]);
    expect([...decodeBase64('AQI D\n')]).toEqual([1, 2, 3]);
  });

  test('pcmFormatFromMime reads rate / channels with Gemini defaults', () => {
    expect(pcmFormatFromMime('audio/L16;codec=pcm;rate=16000')).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(pcmFormatFromMime('audio/l16; rate=8000; channels=2')).toEqual({ sampleRate: 8_000, channels: 2, bitsPerSample: 16 });
    expect(pcmFormatFromMime('audio/L16')).toEqual({ sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
    expect(pcmFormatFromMime('audio/L16;rate=abc')).toMatchObject({ sampleRate: 24_000 });
  });
});
