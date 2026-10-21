/**
 * @file Voice Orchestrator — เลือก TTS / STT provider และ fallback อัตโนมัติ
 *
 * - **TTS** `speak(text, persona)`: เสียงของ persona (หรือเสียงรวม) → TTS priority → ลำดับลงทะเบียน
 *   → **Expo Speech เป็นตัวสุดท้ายเสมอ** (บนเครื่อง ไม่ต้องใช้ key) — ผู้ช่วยไม่เงียบ
 * - **STT** `listen(uri)`: STT ที่เลือก → STT priority → ที่เหลือที่เปิดอยู่
 * - **ไมค์** `requestMicrophone()`: เรียกก่อนบันทึกเสียง ไม่ได้สิทธิ์ → error `permission` (ไม่ fallback)
 *
 * ใช้เงื่อนไข fallback เดียวกับ AI (`ProviderError.shouldFallback`)
 * ล้มทุกตัว → ProviderError เดียว ("ผู้ให้บริการเสียงทุกรายล้มเหลว") ที่คง kind ร่วมไว้
 *
 * @see ../../../../docs/ARCHITECTURE.md — หัวข้อ 4 Orchestrator pattern
 * @see ../../../../docs/DECISIONS.md — ADR-008 Expo Speech เป็น TTS สำรองสุดท้ายเสมอ
 */

import {
  ProviderError,
  commonKind,
  toProviderError,
  type ProviderErrorKind,
} from '../../../core/http/errors';
import {
  ProviderSettings,
  type PersonaVoice,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import type { Persona } from '../../../core/types/persona';
import { ensureMicPermission } from './permissions';
import { splitSentences, takeSpeakable } from './sentences';
import { voiceRegistry, type VoiceRegistry } from './VoiceRegistry';
import type { SpeakOptions, STTProvider, TTSProvider, TTSProviderId } from './types';

/** On-device and keyless, so it is always the last TTS resort even if switched off. */
const LAST_RESORT_TTS: TTSProviderId = 'expo';

/** ตัวพูดแบบสตรีม (คืนจาก {@link VoiceOrchestrator.speakStream}) */
export interface SpeechStream {
  /** ต่อท้ายข้อความที่ AI เพิ่งพิมพ์ออกมา */
  push(text: string): void;
  /** ข้อความครบแล้ว — พูดส่วนที่เหลือ · resolve เมื่อพูดจบ (หรือถูกหยุด) */
  end(): Promise<void>;
  /** เริ่มออกเสียงไปแล้วหรือยัง */
  readonly started: boolean;
}

/** ท่อนที่เตรียมเสียงเสร็จแล้ว รอเล่น */
interface Prepared {
  tts: TTSProvider;
  /** ข้อความของท่อน (ใช้พูดซ้ำด้วยเจ้าอื่นถ้าเล่นไม่ได้) */
  text: string;
  play(): Promise<void>;
  discard(): void;
}

/** ผลของการดึงท่อนถัดไป: จบสตรีม หรือได้ท่อน (prepared = null → ทุกเจ้าพูดท่อนนี้ไม่ได้ ข้าม) */
type NextChunk = { done: true } | { done: false; prepared: Prepared | null };

/**
 * Picks voice providers and falls back when one fails (401/403/429/5xx/timeout/network/no key).
 * TTS: the persona's voice (or the shared voice) → TTS priority list (enabled) → Expo Speech.
 * STT: STT priority list (enabled) → remaining enabled providers.
 */
export class VoiceOrchestrator {
  private speaking: TTSProvider | null = null;
  /** เพิ่มทุกครั้งที่ speak()/stop() — ลูปพูดทีละประโยคของรอบเก่าเช็กแล้วหยุดเอง */
  private speakRun = 0;
  /** ปลุกลูปของ speakStream ที่กำลังรอข้อความ — stop() เรียกเพื่อให้ลูปเห็นว่าถูกหยุดทันที */
  private streamSignal: (() => void) | null = null;

  constructor(
    private readonly registry: VoiceRegistry = voiceRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings,
  ) {}

  /**
   * พูดคำตอบ — แบ่งเป็นประโยคย่อยแล้วพูดทีละประโยค เพื่อให้ได้ยินเสียงประโยคแรกเร็ว (ไม่ต้องรอสังเคราะห์ทั้งก้อน)
   * - แต่ละประโยคมี fallback ครบ: ลองเจ้าที่พูดประโยคก่อนหน้าสำเร็จก่อน แล้วค่อยไล่ chain ที่เหลือ
   *   (เจ้าเดิมล้มกลางคัน → ตกไป Expo Speech ให้เสียงไม่ขาด ไม่ใช่พูดค้างครึ่งคำตอบ)
   * - อ่านค่าเสียง (voiceId) ของแต่ละเจ้าครั้งเดียวทั้งคำตอบ (memo) ไม่อ่าน AsyncStorage ซ้ำทุกประโยค
   */
  async speak(text: string, personaId: Persona): Promise<void> {
    const voice = await this.settings.resolveVoiceFor(personaId);
    const chain = await this.ttsChainFor(voice);
    this.stop(); // ตัดเสียงรอบก่อนที่ค้างอยู่ (stop() เพิ่ม speakRun ให้ด้วย)
    const run = this.speakRun;

    const optsCache = new Map<TTSProviderId, SpeakOptions>();
    const optionsFor = async (id: TTSProviderId): Promise<SpeakOptions> => {
      const cached = optsCache.get(id);
      if (cached) return cached;
      const opts = await this.resolveOptions(id, voice);
      optsCache.set(id, opts);
      return opts;
    };

    const sentences = splitSentences(text);
    // ประโยคแรก: ไล่ chain ตามปกติ (ล้มทุกตัว = throw ให้ผู้เรียกจัดการ) · คืนเจ้าที่พูดสำเร็จ
    let spoke = await this.speakOnChain(chain, sentences[0] ?? text, optionsFor, run, true);
    // ที่เหลือ: เอาเจ้าที่เพิ่งสำเร็จขึ้นก่อน แล้วตามด้วย chain เดิม (ยังมี fallback) · ล้มหมด = หยุดเงียบ ๆ
    for (let i = 1; i < sentences.length; i++) {
      if (run !== this.speakRun || !spoke) return; // บอสกดหยุด / speak ใหม่ / พูดไม่ได้แล้ว
      const ordered = [spoke, ...chain.filter((p) => p !== spoke)];
      spoke = await this.speakOnChain(ordered, sentences[i] ?? '', optionsFor, run, false);
    }
  }

  /**
   * พูดคำตอบที่ยัง "กำลังพิมพ์" (สตรีมจาก AI) — `push()` ข้อความทีละท่อน · `end()` = ข้อความครบแล้ว
   * - ดึงส่วนที่พูดได้ ({@link takeSpeakable}) ทันทีที่มี → ท่อนแรกเริ่มพูดได้ตั้งแต่ AI ยังตอบไม่จบ
   * - ระหว่างพูดท่อนนี้ เตรียมเสียงท่อนถัดไปล่วงหน้า (`prepare`) → ไม่มีช่องเงียบรอสังเคราะห์ระหว่างท่อน
   * - `onFirst` เรียกก่อนเริ่มพูดท่อนแรก · คืน false = ไม่พูดเลย (บอสหยุดโหมดเสียงระหว่างรอ)
   * - fallback ต่อท่อนเหมือน speak(): ลองเจ้าที่เพิ่งสำเร็จก่อน → chain ที่เหลือ → Expo Speech
   * - stop() / speak ใหม่ = หยุดทันที ทิ้งท่อนที่เตรียมไว้
   */
  speakStream(personaId: Persona, hooks: { onFirst?: () => boolean } = {}): SpeechStream {
    this.stop(); // ตัดเสียงรอบก่อน
    const run = this.speakRun;
    const alive = () => run === this.speakRun;

    let buffer = '';
    let ended = false;
    let first = true;
    let started = false;
    let wake: (() => void) | null = null;
    const signal = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    this.streamSignal = signal;

    const setup = (async () => {
      const voice = await this.settings.resolveVoiceFor(personaId);
      return { voice, chain: await this.ttsChainFor(voice) };
    })();
    const optsCache = new Map<TTSProviderId, SpeakOptions>();
    let preferred: TTSProvider | null = null;

    /** รอจนมีท่อนพูดได้ · null = จบ (สตรีมปิดและหมด buffer) หรือถูกหยุด */
    const nextChunk = async (): Promise<string | null> => {
      for (;;) {
        if (!alive()) return null;
        const [speakable, rest] = takeSpeakable(buffer, { first, final: ended });
        if (speakable) {
          buffer = rest;
          first = false;
          return speakable;
        }
        if (ended) return null;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    };

    /** เจ้าที่เล่นเสียงไม่ได้ในสตรีมนี้ (เช่น player พัง) — ท่อนต่อ ๆ ไปข้ามเจ้านี้เลย */
    const broken = new Set<TTSProvider>();

    /**
     * เตรียมเสียงหนึ่งท่อน: ลองเจ้าที่เพิ่งสำเร็จก่อน → chain ที่เหลือ → Expo Speech · null = ทุกเจ้าใช้ไม่ได้ (ข้ามท่อนนี้)
     * ไม่ throw เด็ดขาด (ถูกเรียกแบบไม่มีใครรอทันที — reject = unhandled rejection)
     */
    const prepareChunk = async (text: string): Promise<Prepared | null> => {
      try {
        const { voice, chain } = await setup;
        const usable = chain.filter((p) => !broken.has(p));
        const ordered =
          preferred && !broken.has(preferred)
            ? [preferred, ...usable.filter((p) => p !== preferred)]
            : usable;
        for (const tts of ordered) {
          if (!alive()) return null;
          try {
            let opts = optsCache.get(tts.id);
            if (!opts) {
              opts = await this.resolveOptions(tts.id, voice);
              optsCache.set(tts.id, opts);
            }
            const speakOpts = opts;
            if (tts.prepare) {
              const ready = await tts.prepare(text, speakOpts);
              preferred = tts;
              return { tts, text, play: () => ready.play(), discard: () => ready.discard() };
            }
            preferred = tts;
            return {
              tts,
              text,
              play: () => tts.speak(text, speakOpts),
              discard: () => undefined,
            };
          } catch (e) {
            // ท่อนสั้น ๆ ระหว่างสตรีม: ลองเจ้าถัดไปเสมอ (ให้เสียงไม่ขาด) แม้ error จะไม่ใช่ประเภท fallback
            console.error(`[voice] ${tts.id} เตรียมเสียงท่อนนี้ไม่ได้ — ลองเจ้าถัดไป`, e);
          }
        }
      } catch (e) {
        console.error('[voice] อ่านการตั้งค่าเสียงไม่ได้', e);
      }
      console.error('[voice] ไม่มีผู้ให้บริการเสียงที่พูดท่อนนี้ได้ — ข้าม');
      return null;
    };

    /** เล่นท่อนที่เตรียมไว้ · เล่นไม่ได้ (player พัง) → พูดท่อนเดิมด้วยเจ้าถัดไป (เหมือน speak() ที่ตกไป Expo) */
    const playChunk = async (prepared: Prepared): Promise<void> => {
      started = true;
      this.speaking = prepared.tts;
      try {
        await prepared.play();
        return;
      } catch (e) {
        console.error(`[voice] ${prepared.tts.id} เล่นเสียงไม่ได้ — ใช้เจ้าถัดไปแทน`, e);
        broken.add(prepared.tts);
        if (preferred === prepared.tts) preferred = null;
      } finally {
        if (this.speaking === prepared.tts) this.speaking = null;
      }
      if (!alive()) return;
      const retry = await prepareChunk(prepared.text);
      if (!retry || !alive()) {
        retry?.discard();
        return;
      }
      this.speaking = retry.tts;
      try {
        await retry.play();
      } catch (e) {
        console.error('[voice] เล่นเสียงท่อนนี้ไม่ได้ — ข้าม', e);
        broken.add(retry.tts);
      } finally {
        if (this.speaking === retry.tts) this.speaking = null;
      }
    };

    const worker = (async () => {
      const firstText = await nextChunk();
      if (firstText === null) return;
      if (hooks.onFirst && !hooks.onFirst()) {
        this.stop(); // ไม่พูดรอบนี้ (ปิด alive ให้ทุกอย่างหยุด)
        return;
      }
      // แยก "จบสตรีม" (done) ออกจาก "ท่อนนี้พูดไม่ได้ ข้าม" (prepared = null) — ห้ามเช็ก Promise ตรง ๆ (truthy เสมอ = วนไม่จบ)
      const pull = async (): Promise<NextChunk> => {
        const text = await nextChunk();
        return text === null ? { done: true } : { done: false, prepared: await prepareChunk(text) };
      };
      let current: Promise<NextChunk> = prepareChunk(firstText).then((prepared) => ({
        done: false,
        prepared,
      }));
      for (;;) {
        const next = await current;
        if (next.done) return;
        const { prepared } = next;
        if (!alive()) {
          prepared?.discard();
          return;
        }
        // เริ่มรอ+เตรียมท่อนถัดไปพร้อมกับที่ท่อนนี้กำลังพูด
        const following = pull();
        if (prepared) await playChunk(prepared);
        current = following;
      }
    })().catch((e: unknown) => {
      // ลูปต้องไม่ reject (ทางที่ไม่มีใครเรียก end() เช่นตอบล้มแล้ว stop()) — log แทน
      console.error('[voice] ตัวพูดแบบสตรีมหยุดกลางคัน', e);
    });

    return {
      push: (text) => {
        if (ended || !alive()) return;
        buffer += text;
        signal();
      },
      end: async () => {
        ended = true;
        signal();
        await worker;
      },
      get started() {
        return started;
      },
    };
  }

  stop(): void {
    this.speakRun++;
    this.streamSignal?.(); // ปลุกลูปสตรีมที่รอข้อความอยู่ให้เห็นว่าถูกหยุด
    this.streamSignal = null;
    this.speaking?.stop();
    this.speaking = null;
  }

  /** ลำดับเจ้า TTS ที่จะลอง: เสียงของ persona → priority → ที่ลงทะเบียน → Expo Speech (ท้ายสุดเสมอ) */
  private async ttsChainFor(voice?: PersonaVoice): Promise<TTSProvider[]> {
    const ids = unique([
      ...(voice ? [voice.providerId] : []),
      ...(await this.settings.getVoicePriority('tts')),
      ...this.registry.listTTS().map((p) => p.id),
    ]);
    const chain: TTSProvider[] = [];
    for (const id of ids) {
      const tts = this.registry.getTTS(id);
      if (tts && (await this.settings.getVoiceEnabled('tts', id))) chain.push(tts);
    }
    const lastResort = this.registry.getTTS(LAST_RESORT_TTS);
    if (lastResort && !chain.includes(lastResort)) chain.push(lastResort);
    return chain;
  }

  /**
   * พูดข้อความหนึ่งก้อนผ่าน chain · คืนเจ้าที่พูดสำเร็จ (ให้ประโยคถัดไปใช้ซ้ำก่อน)
   * `throwIfAllFail` true (ประโยคแรก) = ล้มทุกตัวโยน error · false (ประโยคถัด ๆ) = คืน null เงียบ ๆ (คำตอบอยู่บนจอแล้ว)
   */
  private async speakOnChain(
    chain: TTSProvider[],
    text: string,
    optionsFor: (id: TTSProviderId) => Promise<SpeakOptions>,
    run: number,
    throwIfAllFail: boolean,
  ): Promise<TTSProvider | null> {
    if (!chain.length) {
      if (!throwIfAllFail) return null;
      throw new ProviderError('voice', 'unsupported', 'ไม่มีผู้ให้บริการเสียงที่เปิดใช้งาน');
    }
    const failures: ProviderError[] = [];
    for (const tts of chain) {
      if (run !== this.speakRun) return null; // ถูกหยุด/แทนที่ระหว่างไล่ chain
      this.speaking = tts;
      try {
        await tts.speak(text, await optionsFor(tts.id));
        if (this.speaking === tts) this.speaking = null;
        return tts;
      } catch (e) {
        if (this.speaking === tts) this.speaking = null;
        const err = toProviderError(tts.id, e);
        if (!err.shouldFallback) {
          if (!throwIfAllFail) return null;
          throw err;
        }
        failures.push(err);
      }
    }
    if (run !== this.speakRun || !throwIfAllFail) return null;
    throw new ProviderError(
      'voice',
      chainKind(failures),
      `ผู้ให้บริการเสียงทุกรายล้มเหลว:\n${failures.map((f) => f.message).join('\n')}`,
    );
  }

  /** Call before recording: rejects with a Thai `permission` error when the mic is denied. */
  requestMicrophone(): Promise<void> {
    return ensureMicPermission();
  }

  /** Transcribes a recorded audio file (record with expo-audio, then pass recorder.uri). */
  async listen(audioUri: string): Promise<string> {
    const preferred = await this.settings.getSTT();
    const ids = unique([
      ...(preferred ? [preferred] : []),
      ...(await this.settings.getVoicePriority('stt')),
      ...this.registry.listSTT().map((p) => p.id),
    ]);
    const chain: STTProvider[] = [];
    for (const id of ids) {
      const stt = this.registry.getSTT(id);
      if (stt && (await this.settings.getVoiceEnabled('stt', id))) chain.push(stt);
    }
    return this.runChain(chain, (stt) => stt.transcribe(audioUri));
  }

  /** The persona's voice settings apply to its own provider; fallbacks use their default voice. */
  private async resolveOptions(id: TTSProviderId, voice?: PersonaVoice): Promise<SpeakOptions> {
    const voiceId =
      voice?.providerId === id
        ? voice.voiceId
        : await this.settings.getOption(`tts.${id}`, 'voiceId');
    return { voiceId, speed: voice?.speed, pitch: voice?.pitch };
  }

  private async runChain<P extends { id: string }, R>(
    chain: P[],
    run: (provider: P) => Promise<R>,
  ): Promise<R> {
    if (!chain.length) {
      throw new ProviderError('voice', 'unsupported', 'ไม่มีผู้ให้บริการเสียงที่เปิดใช้งาน');
    }
    const failures: ProviderError[] = [];
    for (const provider of chain) {
      try {
        return await run(provider);
      } catch (e) {
        const err = toProviderError(provider.id, e);
        if (!err.shouldFallback) throw err;
        failures.push(err);
      }
    }
    throw new ProviderError(
      'voice',
      chainKind(failures),
      `ผู้ให้บริการเสียงทุกรายล้มเหลว:\n${failures.map((f) => f.message).join('\n')}`,
    );
  }
}

/**
 * kind รวมของ chain ที่ล้มทุกตัว — ถ้าทุกตัวล้มเพราะ "ยังไม่ได้ตั้งค่า" (ไม่มี key / ใช้บนเครื่องไม่ได้)
 * ให้เป็น `missing_key` แทน `server` เพื่อให้ UI บอกบอสให้ไปตั้งค่า (ค่าเริ่มต้น: STT ทุกตัวเปิด แต่ไม่มี key
 * + Expo STT = unsupported → commonKind จะได้ 'server' ซึ่งพาไปผิดทาง)
 */
function chainKind(failures: readonly ProviderError[]): ProviderErrorKind {
  const notConfigured = failures.every((f) => f.kind === 'missing_key' || f.kind === 'unsupported');
  if (notConfigured && failures.some((f) => f.kind === 'missing_key')) return 'missing_key';
  return commonKind(failures);
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

export const voiceOrchestrator = new VoiceOrchestrator();
