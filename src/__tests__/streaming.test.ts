/** สตรีมคำตอบ (Voice: พูดระหว่าง AI ยังพิมพ์) — HTTP · Gemini SSE · Orchestrator · ตัวแบ่งท่อน · ตัวพูดแบบสตรีม */
import * as Speech from 'expo-speech';

import { ProviderError } from '../core/http/errors';
import { requestStream } from '../core/http/request';
import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { createProvider, PROVIDERS, registerAIProviders } from '../features/ai';
import { GeminiAdapter, thinkingFor } from '../features/ai/adapters/GeminiAdapter';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { ProviderRegistry } from '../features/ai/core/ProviderRegistry';
import type { AIProvider, AIProviderConfig, ChatRequest } from '../features/ai/core/types';
import { registerVoiceProviders } from '../features/voice';
import { takeSpeakable } from '../features/voice/core/sentences';
import { VoiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { VoiceRegistry } from '../features/voice/core/VoiceRegistry';
import type { PreparedSpeech, TTSProvider } from '../features/voice/core/types';
import { nth } from '../test-utils/nth';
import { resetSettings } from '../test-utils/setup';

const enc = new TextEncoder();
/** Response ที่ body ส่งทีละท่อนตามลำดับ (จำลอง SSE ที่มาเป็นก้อน ๆ) */
const chunked = (parts: string[], status = 200) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    }),
    { status },
  );

const sse = (text: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], ...extra })}\n\n`;

beforeEach(() => resetSettings());
afterEach(() => jest.restoreAllMocks());

describe('requestStream', () => {
  test('ส่งข้อความทีละท่อนตามที่มาถึง', async () => {
    const got: string[] = [];
    await requestStream('x', 'https://e', { fetchImpl: async () => chunked(['ab', 'cd']) }, (t) =>
      got.push(t),
    );
    expect(got.join('')).toBe('abcd');
    expect(got.length).toBeGreaterThanOrEqual(2); // มาเป็นท่อน ไม่ใช่ก้อนเดียว
  });

  test('HTTP error → ProviderError ตามกติกาเดิม (429 = rate_limit)', async () => {
    await expect(
      requestStream('x', 'https://e', { fetchImpl: async () => chunked(['{}'], 429) }, () => {}),
    ).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  test('fetch ล้ม → network', async () => {
    await expect(
      requestStream(
        'x',
        'https://e',
        {
          fetchImpl: async () => {
            throw new Error('offline');
          },
        },
        () => {},
      ),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('GeminiAdapter.chatStream (SSE)', () => {
  const config = PROVIDERS.find((p) => p.id === 'gemini') as AIProviderConfig;
  const req: ChatRequest = { model: 'gemini-x', messages: [{ role: 'user', content: 'hi' }] };

  beforeEach(async () => SecureKeyStore.set('ai.gemini', 'k'));

  test('event ถูกตัดข้ามท่อน → ประกอบถูก · ข้าม part ที่เป็น thought · เรียก streamGenerateContent?alt=sse', async () => {
    const body = sse('สวัสดี') + sse('ครับ');
    const thought = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'คิดอยู่', thought: true }] } }] })}\n\n`;
    const all = body + thought + sse('บอส');
    // ตัดกลาง JSON ให้ข้ามท่อน
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        chunked([all.slice(0, 17), all.slice(17, 60), all.slice(60)]),
      );
    const deltas: string[] = [];
    const res = await (createProvider(config) as GeminiAdapter).chatStream(req, (d) =>
      deltas.push(d),
    );
    expect(deltas).toEqual(['สวัสดี', 'ครับ', 'บอส']);
    expect(res.content).toBe('สวัสดีครับบอส');
    expect(String(nth(fetchSpy.mock.calls, 0)[0])).toContain(':streamGenerateContent?alt=sse');
  });

  test('body ไม่ใช่ SSE (JSON ก้อนเดียว) → ยังได้คำตอบ (ท่อนเดียว)', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ก้อนเดียว' }] } }] }),
          ),
      );
    const deltas: string[] = [];
    const res = await (createProvider(config) as GeminiAdapter).chatStream(req, (d) =>
      deltas.push(d),
    );
    expect(deltas).toEqual(['ก้อนเดียว']);
    expect(res.content).toBe('ก้อนเดียว');
  });

  test('ไม่มีข้อความเลย → invalid_response', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => chunked([sse('')]));
    await expect(
      (createProvider(config) as GeminiAdapter).chatStream(req, () => {}),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('Orchestrator.chatStream', () => {
  const base = PROVIDERS.find((p) => p.id === 'openrouter') as AIProviderConfig;
  const fake = (
    id: string,
    impl: Partial<Pick<AIProvider, 'chat' | 'chatStream'>>,
  ): AIProvider => ({
    config: { ...base, id: id as AIProviderConfig['id'], name: id, enabled: true },
    chat: impl.chat ?? (async () => ({ content: `จาก ${id}`, model: 'm', providerId: base.id })),
    ...(impl.chatStream && { chatStream: impl.chatStream }),
    testConnection: async () => ({ ok: true }),
    getModels: async () => [],
  });

  test('เจ้าแรกล้มก่อนส่งข้อความ → fallback ไปเจ้าถัดไป (ไม่มีคำซ้ำ)', async () => {
    const reg = new ProviderRegistry();
    reg.register(
      fake('custom-a', {
        chatStream: async () => {
          throw new ProviderError('custom-a', 'server', 'boom');
        },
      }),
    );
    reg.register(fake('custom-b', {}));
    const deltas: string[] = [];
    const res = await new Orchestrator(reg).chatStream(
      { messages: [{ role: 'user', content: 'x' }] },
      (d) => deltas.push(d),
    );
    expect(res.content).toBe('จาก custom-b');
    expect(deltas).toEqual(['จาก custom-b']); // เจ้าไม่สตรีม = ส่งทั้งก้อนครั้งเดียว
  });

  test('ล้มหลังส่งข้อความไปแล้ว → คืนเท่าที่ได้ ไม่ไปเจ้าอื่น (กันพูดซ้ำ/ปน)', async () => {
    const reg = new ProviderRegistry();
    reg.register(
      fake('custom-a', {
        chatStream: async (_r, onDelta) => {
          onDelta('ครึ่ง');
          throw new ProviderError('custom-a', 'network', 'สายหลุด');
        },
      }),
    );
    const other = jest.fn(async () => ({
      content: 'ไม่ควรถูกเรียก',
      model: 'm',
      providerId: base.id,
    }));
    reg.register(fake('custom-b', { chat: other }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await new Orchestrator(reg).chatStream(
      { messages: [{ role: 'user', content: 'x' }] },
      () => {},
    );
    expect(res.content).toBe('ครึ่ง');
    expect(other).not.toHaveBeenCalled();
  });
});

describe('takeSpeakable — ตัดท่อนที่พูดได้ระหว่างสตรีม', () => {
  test('ท่อนแรก = จุดจบประโยคแรก (เริ่มพูดเร็ว)', () => {
    expect(
      takeSpeakable('ได้เลยครับ. เดี๋ยวจัดให้นะ. แล้ว', { first: true, final: false }),
    ).toEqual(['ได้เลยครับ.', 'เดี๋ยวจัดให้นะ. แล้ว']);
  });

  test('ท่อนถัดไป = รวบทุกประโยคที่ครบแล้ว', () => {
    expect(
      takeSpeakable('เดี๋ยวจัดให้นะครับ. เสร็จแล้วบอกนะ. แล้ว', { first: false, final: false }),
    ).toEqual(['เดี๋ยวจัดให้นะครับ. เสร็จแล้วบอกนะ.', 'แล้ว']);
  });

  test('ไทยไม่มีจุด → ตัดที่ช่องว่างเมื่อยาวพอ (เก็บคำที่ยังพิมพ์ไม่จบไว้)', () => {
    const [say, rest] = takeSpeakable('ว่าไงลูกพี่บอส ดึกป่านนี้ยังไม่นอนอีกเร', {
      first: true,
      final: false,
    });
    expect(say).toBe('ว่าไงลูกพี่บอส');
    expect(rest).toBe('ดึกป่านนี้ยังไม่นอนอีกเร');
  });

  test('สั้นเกินและยังไม่จบ → ยังไม่พูด · จบสตรีม → พูดทั้งหมด', () => {
    expect(takeSpeakable('สวัสดีครับ', { first: true, final: false })).toEqual(['', 'สวัสดีครับ']);
    expect(takeSpeakable('สวัสดีครับ', { first: true, final: true })).toEqual(['สวัสดีครับ', '']);
  });
});

describe('VoiceOrchestrator.speakStream', () => {
  /** TTS ปลอมที่มี prepare (เหมือนเจ้า cloud) — จด log ลำดับเตรียม/เล่น */
  function cloudTTS(log: string[]): TTSProvider {
    return {
      id: 'openai',
      name: 'openai',
      speak: async (t) => void log.push(`speak:${t}`),
      prepare: async (t): Promise<PreparedSpeech> => {
        log.push(`prep:${t}`);
        return {
          play: async () => void log.push(`play:${t}`),
          discard: () => log.push(`discard:${t}`),
        };
      },
      stop: jest.fn(),
      getVoices: async () => [],
      testConnection: async () => ({ ok: true }),
    };
  }
  const voiceWith = (tts: TTSProvider) => {
    const reg = new VoiceRegistry();
    reg.registerTTS(tts);
    return new VoiceOrchestrator(reg);
  };

  test('เริ่มพูดท่อนแรกก่อนข้อความจะครบ · เตรียมท่อนถัดไประหว่างพูด', async () => {
    const log: string[] = [];
    const voice = voiceWith(cloudTTS(log));
    const stream = voice.speakStream(1);
    stream.push('ได้เลยครับ. ');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toContain('play:ได้เลยครับ.'); // พูดแล้วทั้งที่ AI ยังพิมพ์ไม่จบ
    stream.push('เดี๋ยวจัดการให้เลยนะครับบอส');
    await stream.end();
    expect(log).toEqual([
      'prep:ได้เลยครับ.',
      'play:ได้เลยครับ.',
      'prep:เดี๋ยวจัดการให้เลยนะครับบอส',
      'play:เดี๋ยวจัดการให้เลยนะครับบอส',
    ]);
    expect(stream.started).toBe(true);
  });

  test('onFirst คืน false → ไม่พูดเลย', async () => {
    const log: string[] = [];
    const stream = voiceWith(cloudTTS(log)).speakStream(1, { onFirst: () => false });
    stream.push('สวัสดีครับบอส');
    await stream.end();
    expect(log.filter((l) => l.startsWith('play'))).toEqual([]);
    expect(stream.started).toBe(false);
  });

  test('stop() ระหว่างรอข้อความ → end() จบ ไม่ค้าง ไม่พูดต่อ', async () => {
    const log: string[] = [];
    const voice = voiceWith(cloudTTS(log));
    const stream = voice.speakStream(1);
    stream.push('ประโยคแรกครับ. ');
    await new Promise((r) => setTimeout(r, 0));
    voice.stop();
    stream.push('ประโยคที่สองไม่ควรพูด');
    await stream.end();
    expect(log.some((l) => l.includes('ไม่ควรพูด'))).toBe(false);
  });

  test('เจ้าไม่มี prepare (Expo Speech) → ใช้ speak() ตรง ๆ', async () => {
    const reg = new VoiceRegistry();
    const expoSpeak = jest.mocked(Speech.speak);
    expoSpeak.mockImplementation((_t, opts) => opts?.onDone?.());
    registerVoiceProviders(reg);
    const stream = new VoiceOrchestrator(reg).speakStream(1);
    stream.push('สวัสดีครับบอส');
    await stream.end();
    expect(expoSpeak).toHaveBeenCalledWith('สวัสดีครับบอส', expect.anything());
  });
});

describe('sendMessage — สตรีมทั้งเส้น (บับเบิลสด + พูดระหว่างพิมพ์ + ไม่พูดซ้ำ)', () => {
  test('พูดทีละท่อนตามที่ AI พิมพ์ · บันทึกคำตอบเต็มครั้งเดียว · ไม่พูดทั้งก้อนซ้ำ · ล้างบับเบิลสด', async () => {
    registerAIProviders();
    registerVoiceProviders();
    await SecureKeyStore.set('ai.gemini', 'k');
    useAtomStore.setState({ messagesByPersona: { 1: [], 2: [], 3: [], 4: [] } });
    useAtomStore.getState().setActivePersona(1);

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        chunked([sse('ได้เลยครับ. '), sse('เดี๋ยวเล่าให้ฟังนะครับบอส')]),
      );
    const speak = jest.mocked(Speech.speak);
    speak.mockClear();

    const res = await sendMessage('เล่าเรื่องให้ฟังหน่อย');

    expect(res.reply).toBe('ได้เลยครับ. เดี๋ยวเล่าให้ฟังนะครับบอส');
    const spoken = speak.mock.calls.map((c) => c[0]);
    expect(spoken).toEqual(['ได้เลยครับ.', 'เดี๋ยวเล่าให้ฟังนะครับบอส']); // ทีละท่อน ไม่มีทั้งก้อนซ้ำ
    const assistant = useAtomStore
      .getState()
      .messagesByPersona[1].filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => m.content)).toEqual(['ได้เลยครับ. เดี๋ยวเล่าให้ฟังนะครับบอส']);
    expect(useAtomStore.getState().streaming).toBeNull();
  });
});

describe('แก้ตามรีวิว (สตรีม)', () => {
  test('onText throw → error เดิมส่งต่อ (ไม่เหมาว่าเน็ตหลุด) + ยกเลิกการอ่านสตรีม', async () => {
    const cancel = jest.fn(async () => undefined);
    const res = chunked(['a', 'b']);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no reader');
    const fake = {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: () => reader.read(), cancel }) },
    } as unknown as Response; // จำลอง Response แค่ส่วนที่ requestStream ใช้ (ทดสอบการยกเลิกสตรีม)
    await expect(
      requestStream('x', 'https://e', { fetchImpl: async () => fake }, () => {
        throw new Error('bug ฝั่งผู้ฟัง');
      }),
    ).rejects.toThrow('bug ฝั่งผู้ฟัง');
    expect(cancel).toHaveBeenCalled();
  });

  test('ท้ายท่อนที่เน็ตตัดไม่ใช่จุดจบประโยค ("ราคา 3." + "5 บาท" ไม่ถูกหั่น)', () => {
    expect(takeSpeakable('ราคา 3.', { first: true, final: false })).toEqual(['', 'ราคา 3.']);
    expect(takeSpeakable('ราคา 3.5 บาทครับ. ', { first: true, final: false })[0]).toBe(
      'ราคา 3.5 บาทครับ.',
    );
  });

  test('เล่นเสียงเจ้าแรกไม่ได้ → พูดท่อนเดิมด้วยเจ้าถัดไป (ไม่เงียบ)', async () => {
    const log: string[] = [];
    const brokenTTS: TTSProvider = {
      id: 'openai',
      name: 'openai',
      speak: async () => undefined,
      prepare: async (t) => ({
        play: async () => {
          throw new ProviderError('openai', 'unsupported', 'player พัง');
        },
        discard: () => log.push(`discard:${t}`),
      }),
      stop: jest.fn(),
      getVoices: async () => [],
      testConnection: async () => ({ ok: true }),
    };
    const reg = new VoiceRegistry();
    reg.registerTTS(brokenTTS);
    registerVoiceProviders(reg); // มี Expo Speech เป็นตัวท้าย
    jest.mocked(Speech.speak).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const stream = new VoiceOrchestrator(reg).speakStream(1);
    stream.push('สวัสดีครับบอส');
    await stream.end();
    expect(Speech.speak).toHaveBeenCalledWith('สวัสดีครับบอส', expect.anything());
  });

  test('คำตอบขาดกลางคัน → มี notice บอกบอสว่าไม่ครบ', async () => {
    const base = PROVIDERS.find((p) => p.id === 'openrouter') as AIProviderConfig;
    const reg = new ProviderRegistry();
    reg.register({
      config: { ...base, id: 'custom-a', name: 'A', enabled: true },
      chat: async () => ({ content: 'x', model: 'm', providerId: base.id }),
      chatStream: async (_r, onDelta) => {
        onDelta('ครึ่ง');
        throw new ProviderError('custom-a', 'network', 'หลุด');
      },
      testConnection: async () => ({ ok: true }),
      getModels: async () => [],
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const orch = new Orchestrator(reg);
    await orch.chatStream({ messages: [{ role: 'user', content: 'x' }] }, () => {});
    expect(orch.takeNotices().join('\n')).toContain('ขาดกลางคัน');
  });
});

describe('Gemini คิดน้อยลงเพื่อตอบไว', () => {
  test('3.x = thinkingLevel low · 2.5 flash = ปิดคิด · 2.5 pro / รุ่นอื่น = ไม่ส่ง', () => {
    expect(thinkingFor('gemini-3-flash')).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    expect(thinkingFor('gemini-2.5-flash-lite')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingFor('gemini-2.5-pro')).toEqual({});
    expect(thinkingFor('gemma-3')).toEqual({});
  });
});
