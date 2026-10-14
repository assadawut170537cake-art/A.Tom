import { ProviderError } from '../../../core/http/errors';
import type { STTProvider } from '../core/types';

const UNAVAILABLE =
  'ยังไม่รองรับการถอดเสียงบนเครื่อง — expo-speech มีแต่ TTS; ต้องเพิ่มโมดูล speech recognition (ต้องใช้ development build)';

/**
 * Placeholder for on-device speech recognition. The Expo SDK has no built-in STT module
 * (expo-speech is TTS only), so this reports itself unavailable and VoiceOrchestrator falls back
 * to the cloud providers. Swap in a native recognizer here once one is added.
 */
export class ExpoSpeechSTT implements STTProvider {
  readonly id = 'expo' as const;
  readonly name = 'Expo Speech Recognition';

  async transcribe(_audioUri: string): Promise<string> {
    throw new ProviderError(this.id, 'unsupported', UNAVAILABLE);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: `[${this.id}] ${UNAVAILABLE}` };
  }
}
