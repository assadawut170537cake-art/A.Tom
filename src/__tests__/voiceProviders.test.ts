import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { voiceRegistry } from '../features/voice/core/VoiceRegistry';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import type { STTProviderId, TTSProviderId } from '../features/voice/core/types';
import { STT_PROVIDERS, TTS_PROVIDERS, VOICE_PROVIDER_FIELDS } from '../features/voice/voice.config';
import { bytes, httpError, json, mockFetch, type RecordedCall, type Route } from '../test-utils/mockFetch';
import { registerAll, resetSettings } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

/**
 * ไฟล์ที่ provider append ลง FormData — FormData ของ Node แปลง object `{ uri, name, type }` เป็น string
 * จึงต้องดักที่ append แทน `form.get()` (บน RN object นี้คือ part ไฟล์จริง)
 */
function uploadedPart(field: string): unknown {
  const call = appendSpy?.mock.calls.find(([key]) => key === field);
  return call?.[1];
}
let appendSpy: jest.SpyInstance | undefined;
beforeEach(() => {
  appendSpy = jest.spyOn(FormData.prototype, 'append');
});

const tts = (id: TTSProviderId) => voiceRegistry.getTTS(id)!;
const stt = (id: STTProviderId) => voiceRegistry.getSTT(id)!;

/** Make createAudioPlayer finish playback as soon as play() is called. */
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

/** Set every credential/option a provider needs (main key + extra fields). */
async function configure(kind: 'tts' | 'stt', id: string) {
  await SecureKeyStore.set(secretKey(kind, id), `${id}-key`);
  const fields = (VOICE_PROVIDER_FIELDS[kind] as Record<string, { secrets: readonly string[]; options: readonly string[] }>)[id];
  for (const name of fields?.secrets ?? []) await SecureKeyStore.set(secretKey(kind, id, name), `${id}-${name}`);
  for (const name of fields?.options ?? []) {
    const value =
      name === 'region'
        ? id === 'polly' ? 'us-east-1' : 'southeastasia'
        : name === 'baseURL' ? `https://${id}.local/v1` : `${id}-model`;
    await ProviderSettings.setOption(`${kind}.${id}`, name, value);
  }
}

async function unconfigure(kind: 'tts' | 'stt', id: string) {
  await SecureKeyStore.delete(secretKey(kind, id));
}

test('voice.config lists 10 TTS + 9 STT providers, all registered', () => {
  expect(TTS_PROVIDERS.map((p) => p.id)).toEqual([
    'expo', 'gemini', 'openai', 'elevenlabs', 'google', 'azure', 'polly', 'playht', 'xai', 'custom',
  ]);
  expect(STT_PROVIDERS.map((p) => p.id)).toEqual([
    'expo', 'whisper', 'deepgram', 'google', 'azure', 'assemblyai', 'revai', 'xai', 'custom',
  ]);
  expect(TTS_PROVIDERS.filter((p) => !p.requiresKey).map((p) => p.id)).toEqual(['expo']);
  expect(voiceRegistry.listTTS()).toHaveLength(10);
  expect(voiceRegistry.listTTS().map((p) => p.id)).toEqual(TTS_PROVIDERS.map((p) => p.id));
  expect(voiceRegistry.listSTT()).toHaveLength(9);
});

// ---------------------------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------------------------

interface TTSCase {
  id: TTSProviderId;
  /** Route answering both the probe and speech requests. */
  route: Route;
  probe: (c: RecordedCall) => void;
  speak: (c: RecordedCall) => void;
  voices?: { body: unknown; expected: unknown };
}

const TTS_CASES: TTSCase[] = [
  {
    id: 'openai',
    route: [/api\.openai\.com/, (c) => (c.url.pathname.endsWith('/models') ? json({ data: [] }) : bytes())],
    probe: (c) => {
      expect(c.url.href).toBe('https://api.openai.com/v1/models');
      expect(c.headers.Authorization).toBe('Bearer openai-key');
    },
    speak: (c) => {
      expect(c.url.pathname).toBe('/v1/audio/speech');
      expect(c.body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'สวัสดี', speed: 1.1, response_format: 'mp3' });
    },
  },
  {
    id: 'xai',
    route: [/api\.x\.ai/, (c) => (c.method === 'GET' ? json({ voices: [{ voice_id: 'eve', name: 'Eve' }] }) : bytes())],
    probe: (c) => {
      expect(c.url.href).toBe('https://api.x.ai/v1/tts/voices');
      expect(c.headers.Authorization).toBe('Bearer xai-key');
    },
    speak: (c) => {
      expect(c.url.href).toBe('https://api.x.ai/v1/tts');
      // ไทยไม่อยู่ในรายการภาษาทางการของ xAI → auto
      expect(c.body).toEqual({ text: 'สวัสดี', voice_id: 'nova', language: 'auto', speed: 1.1 });
    },
  },
  {
    id: 'custom',
    route: [/custom\.local/, (c) => (c.url.pathname.endsWith('/models') ? json({ data: [] }) : bytes())],
    probe: (c) => expect(c.url.href).toBe('https://custom.local/v1/models'),
    speak: (c) => {
      expect(c.url.href).toBe('https://custom.local/v1/audio/speech');
      expect(c.body).toMatchObject({ model: 'custom-model' });
    },
  },
  {
    id: 'elevenlabs',
    route: [/api\.elevenlabs\.io/, (c) => (c.method === 'GET' ? json({ voices: [{ voice_id: 'v1', name: 'Adam', labels: { gender: 'male' } }] }) : bytes())],
    probe: (c) => {
      expect(c.url.href).toBe('https://api.elevenlabs.io/v1/voices');
      expect(c.headers['xi-api-key']).toBe('elevenlabs-key');
    },
    speak: (c) => {
      expect(c.url.pathname).toBe('/v1/text-to-speech/nova');
      expect(c.url.searchParams.get('output_format')).toBe('mp3_44100_128');
      expect(c.body).toMatchObject({ text: 'สวัสดี', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1.1 } });
    },
    voices: { body: null, expected: [{ id: 'v1', name: 'Adam', language: undefined, gender: 'male' }] },
  },
  {
    id: 'google',
    route: [
      /texttospeech\.googleapis\.com/,
      (c) =>
        c.method === 'GET'
          ? json({ voices: [{ name: 'th-TH-Standard-A', languageCodes: ['th-TH'], ssmlGender: 'FEMALE' }] })
          : json({ audioContent: 'SUQz' }),
    ],
    probe: (c) => {
      expect(c.url.href).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=th-TH');
      expect(c.headers['x-goog-api-key']).toBe('google-key');
    },
    speak: (c) => {
      expect(c.url.pathname).toBe('/v1/text:synthesize');
      expect(c.body).toMatchObject({
        input: { text: 'สวัสดี' },
        voice: { languageCode: 'th-TH', name: 'nova' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1 },
      });
    },
    voices: { body: null, expected: [{ id: 'th-TH-Standard-A', name: 'th-TH-Standard-A', language: 'th-TH', gender: 'female' }] },
  },
  {
    id: 'azure',
    route: [
      /microsoft\.com/,
      (c) =>
        c.url.pathname.endsWith('/issueToken')
          ? new Response('token')
          : c.url.pathname.endsWith('/voices/list')
            ? json([
                { ShortName: 'th-TH-PremwadeeNeural', LocalName: 'เปรมวดี', Locale: 'th-TH', Gender: 'Female' },
                { ShortName: 'en-US-JennyNeural', Locale: 'en-US', Gender: 'Female' },
              ])
            : bytes(),
    ],
    probe: (c) => {
      expect(c.url.href).toBe('https://southeastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken');
      expect(c.headers['Ocp-Apim-Subscription-Key']).toBe('azure-key');
    },
    speak: (c) => {
      expect(c.url.href).toBe('https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1');
      expect(c.headers['Content-Type']).toBe('application/ssml+xml');
      expect(c.body).toBe(
        '<speak version="1.0" xml:lang="th-TH"><voice name="nova"><prosody rate="+10%">สวัสดี</prosody></voice></speak>'
      );
    },
    voices: { body: null, expected: [{ id: 'th-TH-PremwadeeNeural', name: 'เปรมวดี', language: 'th-TH', gender: 'female' }] },
  },
  {
    id: 'polly',
    route: [/polly\.us-east-1\.amazonaws\.com/, (c) => (c.method === 'GET' ? json({ Voices: [{ Id: 'Joanna', Name: 'Joanna', LanguageCode: 'en-US', Gender: 'Female' }] }) : bytes())],
    probe: (c) => {
      expect(c.url.href).toBe('https://polly.us-east-1.amazonaws.com/v1/voices');
      expect(c.headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=polly-accessKeyId\/\d{8}\/us-east-1\/polly\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/
      );
      expect(c.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    },
    speak: (c) => {
      expect(c.url.pathname).toBe('/v1/speech');
      expect(c.headers.Authorization).toContain('SignedHeaders=content-type;host;x-amz-date');
      expect(c.body).toEqual({
        OutputFormat: 'mp3',
        VoiceId: 'nova',
        Engine: 'neural',
        TextType: 'ssml',
        Text: '<speak><prosody rate="+10%">สวัสดี</prosody></speak>',
      });
    },
    voices: { body: null, expected: [{ id: 'Joanna', name: 'Joanna', language: 'en-US', gender: 'female' }] },
  },
  {
    id: 'playht',
    route: [/api\.play\.ht/, (c) => (c.method === 'GET' ? json([{ id: 'p1', name: 'Nova', language: 'English', gender: 'female' }]) : bytes())],
    probe: (c) => {
      expect(c.url.href).toBe('https://api.play.ht/api/v2/voices');
      expect(c.headers).toMatchObject({ AUTHORIZATION: 'playht-key', 'X-USER-ID': 'playht-userId' });
    },
    speak: (c) => {
      expect(c.url.pathname).toBe('/api/v2/tts/stream');
      expect(c.body).toMatchObject({ text: 'สวัสดี', voice: 'nova', output_format: 'mp3', speed: 1.1 });
    },
    voices: { body: null, expected: [{ id: 'p1', name: 'Nova', language: 'English', gender: 'female' }] },
  },
];

describe.each(TTS_CASES)('TTS $id', ({ id, route, probe, speak, voices }) => {
  test('testConnection without credentials → missing key, no request', async () => {
    await unconfigure('tts', id);
    const { spy } = mockFetch([route]);
    const res = await tts(id).testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(new RegExp(`^\\[${id}\\] ยังไม่ได้ตั้งค่า`));
    expect(spy).not.toHaveBeenCalled();
  });

  test('testConnection with credentials → authenticated probe → ok', async () => {
    await configure('tts', id);
    const { calls } = mockFetch([route]);
    await expect(tts(id).testConnection()).resolves.toEqual({ ok: true });
    probe(nth(calls, 0));
  });

  test('testConnection maps a 401 to an auth message', async () => {
    await configure('tts', id);
    mockFetch([[route[0], () => httpError(401, 'invalid key')]]);
    const res = await tts(id).testConnection();
    expect(res).toEqual({ ok: false, error: expect.stringContaining('HTTP 401: API key ไม่ถูกต้องหรือไม่มีสิทธิ์ — invalid key') });
  });

  test('speak() synthesizes with voice/speed and plays the audio', async () => {
    await configure('tts', id);
    autoFinishingPlayer();
    const { calls } = mockFetch([route]);
    await tts(id).speak('สวัสดี', { voiceId: 'nova', speed: 1.1 });
    speak(calls.at(-1)!);
    expect(createAudioPlayer).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^file:///cache/tts-${id}-\\d+\\.mp3$`)));
  });

  if (voices) {
    test('getVoices() maps the provider voice list', async () => {
      await configure('tts', id);
      mockFetch([route]);
      await expect(tts(id).getVoices()).resolves.toEqual(voices.expected);
    });
  }
});

describe('TTS specifics', () => {
  test('OpenAI voices are the fixed catalogue', async () => {
    const list = await tts('openai').getVoices();
    expect(list.map((v) => v.id)).toEqual(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);
  });

  test('custom TTS needs a base URL option', async () => {
    await SecureKeyStore.set(secretKey('tts', 'custom'), 'k');
    await ProviderSettings.setOption('tts.custom', 'baseURL', '');
    await expect(tts('custom').testConnection()).resolves.toEqual({
      ok: false,
      error: '[custom] ยังไม่ได้ตั้งค่า baseURL',
    });
  });

  test('Google: pitch multiplier → semitones (clamped); empty audio → invalid_response', async () => {
    await configure('tts', 'google');
    autoFinishingPlayer();
    const { calls } = mockFetch([[/texttospeech/, () => json({ audioContent: 'SUQz' })]]);
    await tts('google').speak('a', { pitch: 1.25 });
    await tts('google').speak('b', { pitch: 3 });
    expect((nth(calls, 0).body as { audioConfig: { pitch: number } }).audioConfig.pitch).toBe(5);
    expect((nth(calls, 1).body as { audioConfig: { pitch: number } }).audioConfig.pitch).toBe(20);

    jest.restoreAllMocks();
    mockFetch([[/texttospeech/, () => json({})]]);
    await expect(tts('google').speak('c')).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  test('Azure escapes SSML-special characters in text and voice', async () => {
    await configure('tts', 'azure');
    autoFinishingPlayer();
    const { calls } = mockFetch([[/microsoft\.com/, () => bytes()]]);
    await tts('azure').speak(`<b>"A" & 'B'</b>`, { voiceId: 'x"y' });
    expect(nth(calls, 0).body).toBe(
      '<speak version="1.0" xml:lang="th-TH"><voice name="x&#34;y">&#60;b&#62;&#34;A&#34; &#38; &#39;B&#39;&#60;/b&#62;</voice></speak>'
    );
  });

  test('Polly region defaults to us-east-1 and is configurable', async () => {
    await configure('tts', 'polly');
    await ProviderSettings.setOption('tts.polly', 'region', 'ap-southeast-1');
    const { calls } = mockFetch([[/amazonaws\.com/, () => json({ Voices: [] })]]);
    await tts('polly').getVoices();
    expect(nth(calls, 0).url.host).toBe('polly.ap-southeast-1.amazonaws.com');
    expect(nth(calls, 0).headers.Authorization).toContain('/ap-southeast-1/polly/aws4_request');
  });

  test('Polly without prosody sends plain text; default voice Joanna', async () => {
    await configure('tts', 'polly');
    autoFinishingPlayer();
    const { calls } = mockFetch([[/polly/, () => bytes()]]);
    await tts('polly').speak('hello');
    expect(nth(calls, 0).body).toEqual({ OutputFormat: 'mp3', VoiceId: 'Joanna', Engine: 'neural', TextType: 'text', Text: 'hello' });
  });

  test('blank text is a no-op; stop() halts playback and resolves speak()', async () => {
    await configure('tts', 'openai');
    const { spy } = mockFetch([[/openai/, () => bytes()]]);
    await tts('openai').speak('   ');
    expect(spy).not.toHaveBeenCalled();

    const pause = jest.fn();
    jest.mocked(createAudioPlayer).mockImplementation(
      () => ({ addListener: () => ({ remove: jest.fn() }), play: jest.fn(), pause, remove: jest.fn() }) as never
    );
    const playing = tts('openai').speak('long text');
    await new Promise((r) => setTimeout(r, 10));
    tts('openai').stop();
    await playing;
    expect(pause).toHaveBeenCalled();
  });

  test('stop() during synthesize → stale audio is never played', async () => {
    await configure('tts', 'openai');
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    mockFetch([[/openai/, async () => (await delay(30), bytes())]]);
    const speaking = tts('openai').speak('ช้าหน่อย');
    await delay(5);
    tts('openai').stop();
    await speaking;
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  test('a newer speak() supersedes one still synthesizing', async () => {
    await configure('tts', 'openai');
    autoFinishingPlayer();
    let n = 0;
    mockFetch([[/openai/, async () => (await new Promise((r) => setTimeout(r, ++n === 1 ? 30 : 0)), bytes())]]);
    const first = tts('openai').speak('อันแรก');
    await new Promise((r) => setTimeout(r, 5));
    await tts('openai').speak('อันสอง');
    await first;
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  test('playback failure → unsupported (so the orchestrator can fall back)', async () => {
    await configure('tts', 'openai');
    mockFetch([[/openai/, () => bytes()]]);
    jest.mocked(createAudioPlayer).mockImplementation(
      () =>
        ({
          addListener: () => ({ remove: jest.fn() }),
          play: () => {
            throw new Error('no audio device');
          },
          pause: jest.fn(),
          remove: jest.fn(),
        }) as never
    );
    const err = await tts('openai').speak('x').catch((e) => e);
    expect(err).toMatchObject({ kind: 'unsupported', shouldFallback: true });
    expect(err.message).toContain('no audio device');
  });

  test('playback failure → VoiceOrchestrator falls back to the next voice (Expo Speech)', async () => {
    await configure('tts', 'openai');
    await ProviderSettings.setTTSFor(2, { providerId: 'openai', voiceId: 'nova' });
    const { calls } = mockFetch([[/openai/, () => bytes()]]);
    const remove = jest.fn();
    jest.mocked(createAudioPlayer).mockImplementation(
      () =>
        ({
          addListener: () => ({ remove }),
          play: () => {
            throw new Error('no audio device');
          },
          pause: jest.fn(),
          remove,
        }) as never
    );

    await voiceOrchestrator.speak('สวัสดีครับ', 2);

    expect(nth(calls, 0).url.pathname).toBe('/v1/audio/speech'); // OpenAI synthesized…
    expect(remove).toHaveBeenCalledTimes(2); // …its player and listener were released…
    expect(Speech.speak).toHaveBeenCalledWith('สวัสดีครับ', expect.objectContaining({ language: 'th-TH' })); // …then Expo spoke
  });

  test('Expo Speech: Thai, voice/rate/pitch, voices from the device, errors surface', async () => {
    await tts('expo').speak('สวัสดี', { voiceId: 'th-1', speed: 0.9, pitch: 1.1 });
    expect(Speech.speak).toHaveBeenCalledWith(
      'สวัสดี',
      expect.objectContaining({ language: 'th-TH', voice: 'th-1', rate: 0.9, pitch: 1.1 })
    );
    await expect(tts('expo').getVoices()).resolves.toEqual([{ id: 'th-TH-voice', name: 'Kanya', language: 'th-TH' }]);
    await expect(tts('expo').testConnection()).resolves.toEqual({ ok: true });

    jest.mocked(Speech.speak).mockImplementationOnce((_t, o) => (o?.onError as (e: Error) => void)(new Error('engine')));
    await expect(tts('expo').speak('x')).rejects.toMatchObject({ kind: 'unsupported' });

    jest.mocked(Speech.speak).mockClear();
    await tts('expo').speak('  ');
    expect(Speech.speak).not.toHaveBeenCalled();
    tts('expo').stop();
    expect(Speech.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------------------------

interface STTCase {
  id: STTProviderId;
  route: Route;
  uri: string;
  probe: (c: RecordedCall) => void;
  transcribe: (calls: RecordedCall[]) => void;
}

const STT_CASES: STTCase[] = [
  {
    id: 'whisper',
    uri: 'file:///cache/rec.m4a',
    route: [/api\.openai\.com/, (c) => (c.method === 'GET' ? json({ data: [] }) : json({ text: ' สวัสดีครับ ' }))],
    probe: (c) => expect(c.url.href).toBe('https://api.openai.com/v1/models'),
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.url.pathname).toBe('/v1/audio/transcriptions');
      const form = c.body as FormData;
      expect(form.get('model')).toBe('whisper-1');
      expect(form.get('language')).toBe('th');
      // RN ส่งไฟล์ได้เฉพาะ part แบบ { uri, name, type } — ไม่ใช่ File/Blob ของ expo-file-system
      expect(uploadedPart('file')).toEqual({ uri: 'file:///cache/rec.m4a', name: 'rec.m4a', type: 'audio/mp4' });
    },
  },
  {
    id: 'xai',
    uri: 'file:///cache/rec.m4a',
    route: [/api\.x\.ai/, (c) => (c.method === 'GET' ? json({ voices: [] }) : json({ text: ' สวัสดีครับ ', language: 'th' }))],
    probe: (c) => expect(c.url.href).toBe('https://api.x.ai/v1/tts/voices'),
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.url.href).toBe('https://api.x.ai/v1/stt');
      expect(c.headers.Authorization).toBe('Bearer xai-key');
      const form = c.body as FormData;
      expect(form.get('model')).toBe('grok-voice-transcribe-2.0');
      expect(form.get('language')).toBe('th');
      expect(uploadedPart('file')).toEqual({ uri: 'file:///cache/rec.m4a', name: 'rec.m4a', type: 'audio/mp4' });
    },
  },
  {
    id: 'custom',
    uri: 'file:///cache/rec.m4a',
    route: [/custom\.local/, (c) => (c.method === 'GET' ? json({ data: [] }) : json({ text: 'สวัสดีครับ' }))],
    probe: (c) => expect(c.url.href).toBe('https://custom.local/v1/models'),
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.url.href).toBe('https://custom.local/v1/audio/transcriptions');
      expect((c.body as FormData).get('model')).toBe('custom-model');
    },
  },
  {
    id: 'deepgram',
    uri: 'file:///cache/rec.m4a',
    route: [
      /api\.deepgram\.com/,
      (c) =>
        c.method === 'GET'
          ? json({ projects: [] })
          : json({ results: { channels: [{ alternatives: [{ transcript: 'สวัสดีครับ' }] }] } }),
    ],
    probe: (c) => {
      expect(c.url.href).toBe('https://api.deepgram.com/v1/projects');
      expect(c.headers.Authorization).toBe('Token deepgram-key');
    },
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.url.pathname).toBe('/v1/listen');
      expect(Object.fromEntries(c.url.searchParams)).toEqual({ model: 'nova-2', language: 'th', smart_format: 'true' });
      expect(c.headers['Content-Type']).toBe('audio/mp4');
      expect(c.body).toBeInstanceOf(Uint8Array);
    },
  },
  {
    id: 'google',
    uri: 'file:///cache/rec.wav',
    route: [
      /speech\.googleapis\.com/,
      (c) =>
        (c.body as { audio: { content: string } }).audio.content === ''
          ? json({ error: { message: 'RecognitionAudio not set.' } }, 400)
          : json({ results: [{ alternatives: [{ transcript: 'สวัสดี' }] }, { alternatives: [{ transcript: 'ครับ' }] }] }),
    ],
    probe: (c) => expect(c.headers['x-goog-api-key']).toBe('google-key'),
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.body).toEqual({
        config: { languageCode: 'th-TH', encoding: 'LINEAR16', enableAutomaticPunctuation: true },
        audio: { content: 'UklGRg==' },
      });
    },
  },
  {
    id: 'azure',
    uri: 'file:///cache/rec.wav',
    route: [
      /microsoft\.com/,
      (c) =>
        c.url.pathname.endsWith('/issueToken')
          ? new Response('token')
          : json({ RecognitionStatus: 'Success', DisplayText: 'สวัสดีครับ' }),
    ],
    probe: (c) => expect(c.url.host).toBe('southeastasia.api.cognitive.microsoft.com'),
    transcribe: (calls) => {
      const c = nth(calls, 0);
      expect(c.url.host).toBe('southeastasia.stt.speech.microsoft.com');
      expect(c.url.searchParams.get('language')).toBe('th-TH');
      expect(c.headers['Content-Type']).toBe('audio/wav; codecs=audio/pcm; samplerate=16000');
    },
  },
  {
    id: 'assemblyai',
    uri: 'file:///cache/rec.m4a',
    route: [
      /api\.assemblyai\.com/,
      (c) =>
        c.url.pathname === '/v2/upload'
          ? json({ upload_url: 'https://cdn.assemblyai.com/u1' })
          : c.url.pathname === '/v2/transcript' && c.method === 'POST'
            ? json({ id: 't1', status: 'queued' })
            : c.url.pathname === '/v2/transcript/t1'
              ? json({ id: 't1', status: 'completed', text: 'สวัสดีครับ' })
              : json({ transcripts: [] }),
    ],
    probe: (c) => expect(c.url.href).toBe('https://api.assemblyai.com/v2/transcript?limit=1'),
    transcribe: (calls) => {
      expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
        'POST /v2/upload',
        'POST /v2/transcript',
        'GET /v2/transcript/t1',
      ]);
      expect(nth(calls, 1).body).toEqual({ audio_url: 'https://cdn.assemblyai.com/u1', language_code: 'th' });
      expect(nth(calls, 0).headers.authorization).toBe('assemblyai-key');
    },
  },
  {
    id: 'revai',
    uri: 'file:///cache/rec.m4a',
    route: [
      /api\.rev\.ai/,
      (c) =>
        c.url.pathname.endsWith('/account')
          ? json({ email: 'x' })
          : c.url.pathname.endsWith('/jobs')
            ? json({ id: 'j1', status: 'in_progress' })
            : c.url.pathname.endsWith('/transcript')
              ? new Response('Speaker 0    00:00:01    สวัสดี ครับ')
              : json({ id: 'j1', status: 'transcribed' }),
    ],
    probe: (c) => expect(c.headers.Authorization).toBe('Bearer revai-key'),
    transcribe: (calls) => {
      expect(calls.map((c) => c.url.pathname)).toEqual([
        '/speechtotext/v1/jobs',
        '/speechtotext/v1/jobs/j1',
        '/speechtotext/v1/jobs/j1/transcript',
      ]);
      expect(JSON.parse((nth(calls, 0).body as FormData).get('options') as string)).toEqual({ language: 'th' });
      expect(uploadedPart('media')).toEqual({ uri: 'file:///cache/rec.m4a', name: 'rec.m4a', type: 'audio/mp4' });
      expect(nth(calls, 2).headers.Accept).toBe('text/plain');
    },
  },
];

const EXPECTED_TEXT: Partial<Record<STTProviderId, string>> = { google: 'สวัสดี ครับ', revai: 'สวัสดี ครับ' };

describe.each(STT_CASES)('STT $id', ({ id, route, uri, probe, transcribe }) => {
  test('testConnection without credentials → missing key, no request', async () => {
    await unconfigure('stt', id);
    const { spy } = mockFetch([route]);
    const res = await stt(id).testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(new RegExp(`^\\[${id}\\] ยังไม่ได้ตั้งค่า`));
    expect(spy).not.toHaveBeenCalled();
  });

  test('testConnection with credentials → ok', async () => {
    await configure('stt', id);
    const { calls } = mockFetch([route]);
    await expect(stt(id).testConnection()).resolves.toEqual({ ok: true });
    probe(nth(calls, 0));
  });

  test('testConnection reports 401 as auth', async () => {
    await configure('stt', id);
    mockFetch([[route[0], () => httpError(401)]]);
    const res = await stt(id).testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 401');
  });

  test('transcribe() uploads the recording and returns trimmed text', async () => {
    await configure('stt', id);
    const { calls } = mockFetch([route]);
    await expect(stt(id).transcribe(uri)).resolves.toBe(EXPECTED_TEXT[id] ?? 'สวัสดีครับ');
    transcribe(calls);
  });

  test('missing audio file → bad_request (no upload)', async () => {
    await configure('stt', id);
    const { spy } = mockFetch([route]);
    await expect(stt(id).transcribe(uri.replace('rec', 'missing'))).rejects.toMatchObject({ kind: 'bad_request' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('STT specifics', () => {
  test('Expo (on-device) STT reports unsupported', async () => {
    await expect(stt('expo').transcribe('file:///cache/rec.m4a')).rejects.toMatchObject({ kind: 'unsupported' });
    const res = await stt('expo').testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^\[expo\] ยังไม่รองรับการถอดเสียงบนเครื่อง/);
  });

  test.each([
    ['google', 'file:///cache/rec.m4a'],
    ['azure', 'file:///cache/rec.m4a'],
    ['azure', 'file:///cache/rec.flac'],
  ] as const)('%s rejects unsupported container %s as unsupported (fallback-able)', async (id, uri) => {
    await configure('stt', id);
    const { spy } = mockFetch([]);
    const err = await stt(id).transcribe(uri).catch((e) => e);
    expect(err).toMatchObject({ kind: 'unsupported' });
    expect(err.shouldFallback).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  test('Google STT probe: invalid key (400 API_KEY_INVALID) is auth, not "accepted 400"', async () => {
    await configure('stt', 'google');
    mockFetch([[/speech\.googleapis/, () => json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400)]]);
    const res = await stt('google').testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('API key ไม่ถูกต้อง');
  });

  test('empty transcript → invalid_response ("ไม่ได้ยินเสียงพูด")', async () => {
    await configure('stt', 'whisper');
    mockFetch([[/openai/, () => json({ text: '   ' })]]);
    await expect(stt('whisper').transcribe('file:///cache/rec.m4a')).rejects.toThrow('ไม่ได้ยินเสียงพูด');
  });

  test('Azure non-success recognition status → invalid_response', async () => {
    await configure('stt', 'azure');
    mockFetch([[/microsoft/, () => json({ RecognitionStatus: 'NoMatch' })]]);
    await expect(stt('azure').transcribe('file:///cache/rec.ogg')).rejects.toThrow('NoMatch');
  });

  test('AssemblyAI / Rev AI job failures are reported', async () => {
    await configure('stt', 'assemblyai');
    await configure('stt', 'revai');
    mockFetch([
      [/assemblyai\.com\/v2\/upload/, () => json({ upload_url: 'u' })],
      [/assemblyai\.com\/v2\/transcript$/, () => json({ id: 't9', status: 'queued' })],
      [/assemblyai\.com\/v2\/transcript\/t9/, () => json({ id: 't9', status: 'error', error: 'audio too short' })],
      [/rev\.ai\/speechtotext\/v1\/jobs$/, () => json({ id: 'j9', status: 'in_progress' })],
      [/rev\.ai\/speechtotext\/v1\/jobs\/j9$/, () => json({ id: 'j9', status: 'failed', failure_detail: 'bad media' })],
    ]);
    await expect(stt('assemblyai').transcribe('file:///cache/a.m4a')).rejects.toThrow('audio too short');
    await expect(stt('revai').transcribe('file:///cache/a.m4a')).rejects.toThrow('bad media');
  });
});
