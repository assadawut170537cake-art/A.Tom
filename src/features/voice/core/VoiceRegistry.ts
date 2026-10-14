import type { STTProvider, STTProviderId, TTSProvider, TTSProviderId } from './types';

export class VoiceRegistry {
  private readonly tts = new Map<TTSProviderId, TTSProvider>();
  private readonly stt = new Map<STTProviderId, STTProvider>();

  registerTTS(provider: TTSProvider): void {
    this.tts.set(provider.id, provider);
  }

  registerSTT(provider: STTProvider): void {
    this.stt.set(provider.id, provider);
  }

  getTTS(id: TTSProviderId): TTSProvider | undefined {
    return this.tts.get(id);
  }

  getSTT(id: STTProviderId): STTProvider | undefined {
    return this.stt.get(id);
  }

  listTTS(): TTSProvider[] {
    return [...this.tts.values()];
  }

  listSTT(): STTProvider[] {
    return [...this.stt.values()];
  }
}

export const voiceRegistry = new VoiceRegistry();
