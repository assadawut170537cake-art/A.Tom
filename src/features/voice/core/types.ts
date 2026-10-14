import type { STTProviderId, TTSProviderId } from '../../../core/types/voiceProvider';

// ย้ายไป core/types แล้ว — re-export ไว้ให้ไฟล์ใน features/voice import จากที่เดิมได้
export type { STTProviderId, TTSProviderId } from '../../../core/types/voiceProvider';

export interface TTSProvider {
  id: TTSProviderId;
  name: string;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  stop(): void;
  getVoices(): Promise<Voice[]>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

export interface STTProvider {
  id: STTProviderId;
  name: string;
  transcribe(audioUri: string): Promise<string>;
  startStream?(onResult: (text: string) => void): Promise<void>;
  stopStream?(): void;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

export interface SpeakOptions {
  voiceId?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
}

export interface Voice {
  id: string;
  name: string;
  language?: string | undefined;
  gender?: 'male' | 'female' | 'neutral' | undefined;
}
