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

import { ProviderError, commonKind, toProviderError, type ProviderErrorKind } from '../../../core/http/errors';
import {
  ProviderSettings,
  type PersonaVoice,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import type { Persona } from '../../../core/types/persona';
import { ensureMicPermission } from './permissions';
import { voiceRegistry, type VoiceRegistry } from './VoiceRegistry';
import type { SpeakOptions, STTProvider, TTSProvider, TTSProviderId } from './types';

/** On-device and keyless, so it is always the last TTS resort even if switched off. */
const LAST_RESORT_TTS: TTSProviderId = 'expo';

/**
 * Picks voice providers and falls back when one fails (401/403/429/5xx/timeout/network/no key).
 * TTS: the persona's voice (or the shared voice) → TTS priority list (enabled) → Expo Speech.
 * STT: STT priority list (enabled) → remaining enabled providers.
 */
export class VoiceOrchestrator {
  private speaking: TTSProvider | null = null;

  constructor(
    private readonly registry: VoiceRegistry = voiceRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings
  ) {}

  async speak(text: string, personaId: Persona): Promise<void> {
    const voice = await this.settings.resolveVoiceFor(personaId);
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

    await this.runChain(chain, async (tts) => {
      this.stop();
      this.speaking = tts;
      try {
        await tts.speak(text, await this.optionsFor(tts.id, voice));
      } finally {
        if (this.speaking === tts) this.speaking = null;
      }
    });
  }

  stop(): void {
    this.speaking?.stop();
    this.speaking = null;
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
  private async optionsFor(id: TTSProviderId, voice?: PersonaVoice): Promise<SpeakOptions> {
    const voiceId =
      voice?.providerId === id
        ? voice.voiceId
        : await this.settings.getOption(`tts.${id}`, 'voiceId');
    return { voiceId, speed: voice?.speed, pitch: voice?.pitch };
  }

  private async runChain<P extends { id: string }, R>(
    chain: P[],
    run: (provider: P) => Promise<R>
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
      `ผู้ให้บริการเสียงทุกรายล้มเหลว:\n${failures.map((f) => f.message).join('\n')}`
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
