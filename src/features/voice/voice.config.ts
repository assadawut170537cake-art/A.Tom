import type { STTProviderId, TTSProviderId } from './core/types';

export interface VoiceProviderMeta<Id extends string> {
  id: Id;
  name: string;
  requiresKey: boolean;
  isDefault?: boolean;
}

export const TTS_PROVIDERS: VoiceProviderMeta<TTSProviderId>[] = [
  { id: 'expo', name: 'Expo Speech', requiresKey: false, isDefault: true },
  { id: 'openai', name: 'OpenAI TTS', requiresKey: true },
  { id: 'elevenlabs', name: 'ElevenLabs', requiresKey: true },
  { id: 'google', name: 'Google Cloud TTS', requiresKey: true },
  { id: 'azure', name: 'Azure Speech', requiresKey: true },
  { id: 'polly', name: 'Amazon Polly', requiresKey: true },
  { id: 'playht', name: 'Play.ht', requiresKey: true },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', requiresKey: true },
];

export const STT_PROVIDERS: VoiceProviderMeta<STTProviderId>[] = [
  { id: 'expo', name: 'Expo Speech Recognition', requiresKey: false, isDefault: true },
  { id: 'whisper', name: 'OpenAI Whisper', requiresKey: true },
  { id: 'deepgram', name: 'Deepgram', requiresKey: true },
  { id: 'google', name: 'Google Cloud STT', requiresKey: true },
  { id: 'azure', name: 'Azure Speech', requiresKey: true },
  { id: 'assemblyai', name: 'AssemblyAI', requiresKey: true },
  { id: 'revai', name: 'Rev AI', requiresKey: true },
  { id: 'custom', name: 'Custom', requiresKey: true },
];

/**
 * Credentials and options each provider reads. Secrets live in SecureKeyStore under
 * secretKey(scope, id, field) (field omitted = the main API key); options live in
 * ProviderSettings.getOption(`${scope}.${id}`, name).
 */
export const VOICE_PROVIDER_FIELDS = {
  tts: {
    polly: { secrets: ['accessKeyId'], options: ['region'] },
    playht: { secrets: ['userId'], options: [] },
    azure: { secrets: [], options: ['region'] },
    custom: { secrets: [], options: ['baseURL', 'model'] },
  },
  stt: {
    azure: { secrets: [], options: ['region'] },
    custom: { secrets: [], options: ['baseURL', 'model'] },
  },
} as const;
