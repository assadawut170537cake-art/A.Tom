import type { STTProviderId, TTSProviderId } from '../../../core/types/voiceProvider';

// ย้ายไป core/types แล้ว — re-export ไว้ให้ไฟล์ใน features/voice import จากที่เดิมได้
export type { STTProviderId, TTSProviderId } from '../../../core/types/voiceProvider';

export interface TTSProvider {
  id: TTSProviderId;
  name: string;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /**
   * สังเคราะห์เสียงไว้ล่วงหน้า (ยังไม่เล่น) — ให้แอปเตรียมประโยคถัดไประหว่างที่ประโยคนี้กำลังพูด (ไม่มีช่องเงียบ)
   * ไม่มี = เจ้าที่สังเคราะห์ไม่ใช้เวลา (Expo Speech บนเครื่อง) → เรียก speak() ตรง ๆ ได้
   */
  prepare?(text: string, opts?: SpeakOptions): Promise<PreparedSpeech>;
  stop(): void;
  getVoices(): Promise<Voice[]>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

/** เสียงที่สังเคราะห์เสร็จแล้ว รอเล่น */
export interface PreparedSpeech {
  /** เล่น · resolve เมื่อเล่นจบหรือถูก stop() */
  play(): Promise<void>;
  /** ทิ้งโดยไม่เล่น (ลบไฟล์ใน cache) */
  discard(): void;
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
