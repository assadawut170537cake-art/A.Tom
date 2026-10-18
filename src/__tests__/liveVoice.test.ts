import { ProviderError } from '../core/http/errors';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { STT_PROVIDERS } from '../features/voice/voice.config';
import {
  IDLE_TIMEOUT_MESSAGE,
  IDLE_TIMEOUT_MS,
  LiveVoiceSession,
  MAX_UTTERANCE_MS,
  PRE_SPEECH_RESET_MS,
  SILENCE_END_MS,
  STT_AUTH_FAILED,
  STT_NOT_CONFIGURED,
  describeLiveError,
  type LiveRespondHooks,
  type LiveVoiceDeps,
  type LiveVoiceState,
} from '../features/voice/live/LiveVoiceSession';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings } from '../test-utils/setup';

const LOUD = -20;
const QUIET = -160;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** session + fakes ทั้งหมด — level() อ่านจาก `fx.level` */
function setup(overrides: Partial<LiveVoiceDeps> = {}) {
  let files = 0;
  const meter: { level: number | undefined } = { level: QUIET };
  const fx = {
    get level(): number | undefined {
      return meter.level;
    },
    set level(v: number | undefined) {
      meter.level = v;
    },
    states: [] as LiveVoiceState[],
    messages: [] as string[],
    spoken: [] as string[],
    recorder: {
      start: jest.fn(async () => {}),
      level: jest.fn((): number | undefined => meter.level),
      stop: jest.fn(async () => `file:///cache/rec-${++files}.m4a`),
      release: jest.fn(async () => {}),
      discard: jest.fn(),
    },
    ensureMic: jest.fn(async () => {}),
    transcribe: jest.fn(async (_uri: string) => 'สวัสดีอะตอม'),
    respond: jest.fn(async (text: string, hooks: LiveRespondHooks) => {
      if (hooks.onSpeaking()) fx.spoken.push(text);
    }),
    stopSpeech: jest.fn(),
  };
  const session = new LiveVoiceSession({
    recorder: fx.recorder,
    ensureMic: fx.ensureMic,
    transcribe: fx.transcribe,
    respond: fx.respond,
    stopSpeech: fx.stopSpeech,
    onStateChange: (s) => fx.states.push(s),
    onMessage: (m) => fx.messages.push(m),
    ...overrides,
  });
  return { session, fx };
}

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

/** พูด `ms` แล้วเงียบจนจบประโยค */
async function say(fx: ReturnType<typeof setup>['fx'], ms: number) {
  fx.level = LOUD;
  await advance(ms);
  fx.level = QUIET;
  await advance(SILENCE_END_MS + 100);
}

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('LiveVoiceSession — loop', () => {
  test('start → listening; speech + 1.2s silence → transcribe → respond → speak → listening again', async () => {
    const { session, fx } = setup();
    await session.start();
    expect(fx.ensureMic).toHaveBeenCalledTimes(1);
    expect(fx.recorder.start).toHaveBeenCalledTimes(1);
    expect(session.getState()).toBe('listening');

    await say(fx, 1000);
    expect(fx.recorder.stop).toHaveBeenCalledTimes(1);
    expect(fx.transcribe).toHaveBeenCalledWith('file:///cache/rec-1.m4a');
    expect(fx.respond).toHaveBeenCalledWith('สวัสดีอะตอม', expect.anything());
    expect(fx.spoken).toEqual(['สวัสดีอะตอม']);
    expect(fx.recorder.discard).toHaveBeenCalledWith('file:///cache/rec-1.m4a');
    expect(fx.states).toEqual(['starting', 'listening', 'transcribing', 'thinking', 'speaking', 'listening']);
    expect(fx.recorder.start).toHaveBeenCalledTimes(2);

    // วนรอบที่สองได้
    fx.transcribe.mockResolvedValueOnce('วันนี้อากาศเป็นไง');
    await say(fx, 800);
    expect(fx.spoken).toEqual(['สวัสดีอะตอม', 'วันนี้อากาศเป็นไง']);
    expect(session.getState()).toBe('listening');
    session.stop();
  });

  test('does not record while speaking (recorder stopped before respond, restarted after)', async () => {
    const reply = deferred<void>();
    const { session, fx } = setup({
      respond: jest.fn((_t: string, hooks: LiveRespondHooks) => {
        hooks.onSpeaking();
        return reply.promise;
      }),
    });
    await session.start();
    await say(fx, 600);
    expect(session.getState()).toBe('speaking');
    expect(fx.recorder.stop).toHaveBeenCalledTimes(1);
    expect(fx.recorder.start).toHaveBeenCalledTimes(1);
    // ระหว่างพูด เสียงดังจากลำโพงต้องไม่ทำให้เกิดประโยคใหม่
    fx.level = LOUD;
    await advance(5_000);
    expect(fx.transcribe).toHaveBeenCalledTimes(1);
    reply.resolve();
    await advance(0);
    expect(session.getState()).toBe('listening');
    expect(fx.recorder.start).toHaveBeenCalledTimes(2);
    session.stop();
  });

  test('start() while already active is a no-op', async () => {
    const { session, fx } = setup();
    await session.start();
    await session.start();
    expect(fx.recorder.start).toHaveBeenCalledTimes(1);
    session.stop();
  });
});

describe('LiveVoiceSession — VAD', () => {
  test('a blip shorter than MIN_SPEECH_MS is ignored (no transcription)', async () => {
    const { session, fx } = setup();
    await session.start();
    await say(fx, 200);
    expect(fx.transcribe).not.toHaveBeenCalled();
    expect(session.getState()).toBe('listening');
    // แล้วประโยคจริงหลังจากนั้นยังถูกจับได้
    await say(fx, 900);
    expect(fx.transcribe).toHaveBeenCalledTimes(1);
    session.stop();
  });

  test('a pause shorter than SILENCE_END_MS does not end the sentence', async () => {
    const { session, fx } = setup();
    await session.start();
    fx.level = LOUD;
    await advance(700);
    fx.level = QUIET;
    await advance(SILENCE_END_MS - 300);
    fx.level = LOUD;
    await advance(700);
    expect(fx.transcribe).not.toHaveBeenCalled();
    fx.level = QUIET;
    await advance(SILENCE_END_MS + 100);
    expect(fx.transcribe).toHaveBeenCalledTimes(1);
    session.stop();
  });

  test('speech longer than MAX_UTTERANCE_MS is cut and sent', async () => {
    const reply = deferred<void>();
    const { session, fx } = setup({ respond: jest.fn(() => reply.promise) });
    await session.start();
    fx.level = LOUD;
    await advance(MAX_UTTERANCE_MS - 500);
    expect(fx.transcribe).not.toHaveBeenCalled();
    await advance(600);
    expect(fx.transcribe).toHaveBeenCalledTimes(1);
    expect(session.getState()).toBe('thinking');
    session.stop();
    reply.resolve();
  });

  test('no speech for IDLE_TIMEOUT_MS → leaves live mode with a Thai notice', async () => {
    const { session, fx } = setup();
    await session.start();
    await advance(IDLE_TIMEOUT_MS + 200);
    expect(session.getState()).toBe('idle');
    expect(fx.messages).toEqual([IDLE_TIMEOUT_MESSAGE]);
    expect(fx.recorder.release).toHaveBeenCalled();
    expect(fx.transcribe).not.toHaveBeenCalled();
  });

  test('leading silence is trimmed: recorder restarts every PRE_SPEECH_RESET_MS, idle clock keeps running', async () => {
    const { session, fx } = setup();
    await session.start();
    await advance(PRE_SPEECH_RESET_MS + 150);
    expect(fx.recorder.stop).toHaveBeenCalledTimes(1);
    expect(fx.recorder.discard).toHaveBeenCalledWith('file:///cache/rec-1.m4a');
    expect(fx.recorder.start).toHaveBeenCalledTimes(2);
    expect(session.getState()).toBe('listening');
    await advance(IDLE_TIMEOUT_MS - PRE_SPEECH_RESET_MS);
    expect(session.getState()).toBe('idle');
  });

  test('metering unavailable (undefined) counts as silence', async () => {
    const { session, fx } = setup();
    fx.level = undefined;
    await session.start();
    await advance(5_000);
    expect(fx.transcribe).not.toHaveBeenCalled();
    session.stop();
  });

  test('empty transcript → just listen again (no chat message, no respond)', async () => {
    const { session, fx } = setup();
    fx.transcribe.mockResolvedValueOnce('   ');
    await session.start();
    await say(fx, 800);
    expect(fx.respond).not.toHaveBeenCalled();
    expect(fx.messages).toEqual([]);
    expect(session.getState()).toBe('listening');
    expect(fx.recorder.start).toHaveBeenCalledTimes(2);
    session.stop();
  });
});

describe('LiveVoiceSession — stop', () => {
  test('stop() while listening: recorder stopped + released, speech stopped, no more ticks', async () => {
    const { session, fx } = setup();
    await session.start();
    session.stop();
    await advance(0);
    expect(session.getState()).toBe('idle');
    expect(fx.recorder.stop).toHaveBeenCalledTimes(1);
    expect(fx.recorder.release).toHaveBeenCalledTimes(1);
    expect(fx.stopSpeech).toHaveBeenCalled();
    fx.level = LOUD;
    await advance(IDLE_TIMEOUT_MS * 2);
    expect(fx.transcribe).not.toHaveBeenCalled();
    expect(fx.messages).toEqual([]);
    expect(nth(fx.states, fx.states.length - 1)).toBe('idle');
  });

  test('stop() while transcribing: late transcript is dropped', async () => {
    const stt = deferred<string>();
    const { session, fx } = setup({ transcribe: jest.fn(() => stt.promise) });
    await session.start();
    await say(fx, 800);
    expect(session.getState()).toBe('transcribing');
    session.stop();
    stt.resolve('ข้อความที่มาช้า');
    await advance(0);
    expect(fx.respond).not.toHaveBeenCalled();
    expect(session.getState()).toBe('idle');
  });

  test('stop() while thinking: the reply is not spoken and listening does not resume', async () => {
    const ai = deferred<void>();
    let allowed: boolean | undefined;
    const { session, fx } = setup({
      respond: jest.fn(async (_t: string, hooks: LiveRespondHooks) => {
        await ai.promise;
        allowed = hooks.onSpeaking();
      }),
    });
    await session.start();
    await say(fx, 800);
    expect(session.getState()).toBe('thinking');
    session.stop();
    ai.resolve();
    await advance(0);
    expect(allowed).toBe(false);
    expect(session.getState()).toBe('idle');
    expect(fx.recorder.start).toHaveBeenCalledTimes(1);
  });

  test('stop() while speaking stops the voice', async () => {
    const reply = deferred<void>();
    const { session, fx } = setup({
      respond: jest.fn((_t: string, hooks: LiveRespondHooks) => {
        hooks.onSpeaking();
        return reply.promise;
      }),
    });
    await session.start();
    await say(fx, 800);
    expect(session.getState()).toBe('speaking');
    session.stop();
    expect(fx.stopSpeech).toHaveBeenCalled();
    reply.resolve();
    await advance(0);
    expect(fx.recorder.start).toHaveBeenCalledTimes(1);
  });

  test('stop() during the mic permission prompt → never starts recording', async () => {
    const mic = deferred<void>();
    const { session, fx } = setup({ ensureMic: jest.fn(() => mic.promise) });
    const started = session.start();
    session.stop();
    mic.resolve();
    await started;
    expect(fx.recorder.start).not.toHaveBeenCalled();
    expect(session.getState()).toBe('idle');
  });
});

describe('LiveVoiceSession — errors', () => {
  test('mic denied → Thai message, live mode off, nothing recorded', async () => {
    const { session, fx } = setup({
      ensureMic: jest.fn(async () => {
        throw new ProviderError('voice', 'permission', 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน');
      }),
    });
    await session.start();
    expect(session.getState()).toBe('idle');
    expect(fx.recorder.start).not.toHaveBeenCalled();
    expect(fx.messages).toEqual(['⚠️ ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน']);
  });

  test('no STT configured → stop + point Boss to ตั้งค่า › เสียง', async () => {
    const { session, fx } = setup({
      transcribe: jest.fn(async () => {
        throw new ProviderError('voice', 'missing_key', 'ผู้ให้บริการเสียงทุกรายล้มเหลว');
      }),
    });
    await session.start();
    await say(fx, 800);
    expect(session.getState()).toBe('idle');
    expect(fx.messages).toEqual([`⚠️ ${STT_NOT_CONFIGURED}`]);
    expect(nth(fx.messages, 0)).toContain('ตั้งค่า › เสียง');
    expect(fx.recorder.discard).toHaveBeenCalledWith('file:///cache/rec-1.m4a');
    expect(fx.respond).not.toHaveBeenCalled();
  });

  test('recorder fails to start → Thai message, live mode off', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { session, fx } = setup();
    fx.recorder.start.mockRejectedValueOnce(new Error('busy'));
    await session.start();
    expect(session.getState()).toBe('idle');
    expect(nth(fx.messages, 0)).toContain('เปิดไมโครโฟนไม่สำเร็จ');
  });

  test('describeLiveError: auth → STT key advice · network → Thai advice + redacted detail', () => {
    expect(describeLiveError(new ProviderError('whisper', 'auth', 'x', 401))).toBe(`⚠️ ${STT_AUTH_FAILED}`);
    expect(describeLiveError(new ProviderError('voice', 'unsupported', 'x'))).toBe(`⚠️ ${STT_NOT_CONFIGURED}`);
    const net = describeLiveError(new ProviderError('whisper', 'network', 'bad key sk-abc123'));
    expect(net).toContain('ถอดเสียงไม่สำเร็จ');
    expect(net).toContain('[REDACTED]');
    expect(net).not.toContain('sk-abc123');
  });
});

describe('VoiceOrchestrator.listen — fresh install (no STT key)', () => {
  beforeAll(registerAll);
  beforeEach(async () => {
    jest.useRealTimers();
    await resetSettings();
    for (const p of STT_PROVIDERS) await SecureKeyStore.delete(secretKey('stt', p.id));
  });

  test('all STT providers unconfigured (missing key + Expo unsupported) → missing_key, so live mode says "ตั้งค่า › เสียง"', async () => {
    const err: unknown = await voiceOrchestrator.listen('file:///cache/rec.m4a').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'missing_key' });
    expect(describeLiveError(err)).toContain('ตั้งค่า › เสียง');
  });

  test('only Expo STT enabled → unsupported (also "not configured")', async () => {
    for (const p of STT_PROVIDERS) if (p.id !== 'expo') await ProviderSettings.setVoiceEnabled('stt', p.id, false);
    const err: unknown = await voiceOrchestrator.listen('file:///cache/rec.m4a').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'unsupported' });
    expect(describeLiveError(err)).toBe(`⚠️ ${STT_NOT_CONFIGURED}`);
  });
});
