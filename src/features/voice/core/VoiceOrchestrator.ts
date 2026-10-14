import { ProviderError, toProviderError } from '../../../core/http/errors';
import {
  ProviderSettings,
  type PersonaVoice,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import type { Persona } from '../../jarvis/types';
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
    const failures: string[] = [];
    for (const provider of chain) {
      try {
        return await run(provider);
      } catch (e) {
        const err = toProviderError(provider.id, e);
        if (!err.shouldFallback) throw err;
        failures.push(err.message);
      }
    }
    throw new ProviderError('voice', 'server', `ผู้ให้บริการเสียงทุกรายล้มเหลว:\n${failures.join('\n')}`);
  }
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

export const voiceOrchestrator = new VoiceOrchestrator();
