/**
 * @file id ของผู้ให้บริการเสียง (TTS 8 + STT 8) — ใช้ร่วมกันระหว่าง core/storage กับ features/voice
 * interface ของ provider ยังอยู่ใน features/voice/core/types
 */

export type TTSProviderId =
  | 'expo'
  | 'openai'
  | 'elevenlabs'
  | 'google'
  | 'azure'
  | 'polly'
  | 'playht'
  | 'custom';

export type STTProviderId =
  | 'expo'
  | 'whisper'
  | 'deepgram'
  | 'google'
  | 'azure'
  | 'assemblyai'
  | 'revai'
  | 'custom';
