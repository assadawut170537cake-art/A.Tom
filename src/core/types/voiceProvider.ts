/**
 * @file id ของผู้ให้บริการเสียง (TTS 10 + STT 9 — xAI Boss เพิ่ม 2026-10-20) — ใช้ร่วมกันระหว่าง core/storage กับ features/voice
 * interface ของ provider ยังอยู่ใน features/voice/core/types
 */

export type TTSProviderId =
  | 'expo'
  | 'gemini'
  | 'openai'
  | 'elevenlabs'
  | 'google'
  | 'azure'
  | 'polly'
  | 'playht'
  | 'xai'
  | 'custom';

export type STTProviderId =
  | 'expo'
  | 'whisper'
  | 'deepgram'
  | 'google'
  | 'azure'
  | 'assemblyai'
  | 'revai'
  | 'xai'
  | 'custom';
