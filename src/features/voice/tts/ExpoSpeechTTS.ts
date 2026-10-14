import * as Speech from 'expo-speech';

import { ProviderError, testWith } from '../../../core/http/errors';
import { TTS_LANGUAGE } from '../core/TTSInterface';
import type { SpeakOptions, TTSProvider, Voice } from '../core/types';

/** On-device TTS via expo-speech. No key, works offline; the default and last-resort fallback. */
export class ExpoSpeechTTS implements TTSProvider {
  readonly id = 'expo' as const;
  readonly name = 'Expo Speech';

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    Speech.stop();
    return new Promise((resolve, reject) => {
      Speech.speak(text.slice(0, Speech.maxSpeechInputLength), {
        language: TTS_LANGUAGE,
        // expo-speech's options don't accept explicit undefined; omit what isn't set
        ...(opts.voiceId !== undefined && { voice: opts.voiceId }),
        ...(opts.speed !== undefined && { rate: opts.speed }),
        ...(opts.pitch !== undefined && { pitch: opts.pitch }),
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: (e) => reject(new ProviderError(this.id, 'unsupported', e.message)),
      });
    });
  }

  stop(): void {
    Speech.stop();
  }

  async getVoices(): Promise<Voice[]> {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.map((v) => ({ id: v.identifier, name: v.name, language: v.language }));
  }

  testConnection(): Promise<{ ok: boolean; error?: string }> {
    return testWith(this.id, () => Speech.getAvailableVoicesAsync());
  }
}
