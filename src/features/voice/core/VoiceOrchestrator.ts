import { ProviderError, toProviderError } from '../../../core/http/errors';
import {
  ProviderSettings,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import type { Persona } from '../../jarvis/types';
import { voiceRegistry, type VoiceRegistry } from './VoiceRegistry';
import type { STTProvider, STTProviderId, TTSProvider, TTSProviderId } from './types';

const DEFAULT_TTS: TTSProviderId = 'expo';
const DEFAULT_STT: STTProviderId = 'expo';

/**
 * Picks voice providers and falls back when one fails (401/403/429/5xx/timeout/network/no key).
 * TTS: the persona's configured provider → on-device Expo Speech.
 * STT: the user's chosen provider → every other registered provider.
 */
export class VoiceOrchestrator {
  private speaking: TTSProvider | null = null;

  constructor(
    private readonly registry: VoiceRegistry = voiceRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings
  ) {}

  async speak(text: string, personaId: Persona): Promise<void> {
    const voice = await this.settings.getTTSFor(personaId);
    const preferred = voice?.providerId ?? DEFAULT_TTS;
    const chain = unique([preferred, DEFAULT_TTS])
      .map((id) => this.registry.getTTS(id))
      .filter((p): p is TTSProvider => !!p);

    await this.runChain(chain, async (tts) => {
      this.stop();
      this.speaking = tts;
      // Voice/speed/pitch belong to the persona's chosen provider; fallbacks use their defaults
      const opts =
        tts.id === preferred
          ? { voiceId: voice?.voiceId, speed: voice?.speed, pitch: voice?.pitch }
          : { speed: voice?.speed, pitch: voice?.pitch };
      try {
        await tts.speak(text, opts);
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
    const preferred = (await this.settings.getSTT()) ?? DEFAULT_STT;
    const chain = [
      this.registry.getSTT(preferred),
      ...this.registry.listSTT().filter((p) => p.id !== preferred),
    ].filter((p): p is STTProvider => !!p);

    return this.runChain(chain, (stt) => stt.transcribe(audioUri));
  }

  private async runChain<P extends { id: string }, R>(
    chain: P[],
    run: (provider: P) => Promise<R>
  ): Promise<R> {
    if (!chain.length) {
      throw new ProviderError('voice', 'unsupported', 'ยังไม่ได้ลงทะเบียนผู้ให้บริการเสียง');
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
