import type { VoiceIdOf, VoiceKind } from '../../core/storage/ProviderSettings';
import type { STTProviderId, TTSProviderId } from './core/types';

// ค่าเริ่มต้นต่อ persona นิยามที่ core (ProviderSettings) — re-export ให้ import จาก voice.config ได้
export { DEFAULT_PERSONA_VOICE_MAP } from '../../core/storage/ProviderSettings';

export interface VoiceProviderMeta<Id extends string> {
  id: Id;
  name: string;
  requiresKey: boolean;
  isDefault?: boolean | undefined;
  /** ข้อความในช่อง API key (เช่น บอกว่าใช้ key ร่วมกับ provider อื่นได้) */
  keyPlaceholder?: string | undefined;
}

export const TTS_PROVIDERS: VoiceProviderMeta<TTSProviderId>[] = [
  { id: 'expo', name: 'Expo Speech', requiresKey: false, isDefault: true },
  {
    id: 'gemini',
    name: 'Gemini TTS',
    requiresKey: true,
    keyPlaceholder: 'ว่างไว้ = ใช้ key ของ Gemini (AI Providers)',
  },
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

/** Extra per-provider settings beyond the main API key. */
export type VoiceFieldName = 'accessKeyId' | 'userId' | 'region' | 'baseURL' | 'model';

export interface VoiceProviderFields {
  /** Stored in SecureKeyStore under secretKey(scope, id, field). */
  secrets: readonly VoiceFieldName[];
  /** Stored in ProviderSettings.getOption(`${scope}.${id}`, name). */
  options: readonly VoiceFieldName[];
}

/** Credentials and options each provider reads (providers not listed need only an API key). */
export const VOICE_PROVIDER_FIELDS: {
  [K in VoiceKind]: Partial<Record<VoiceIdOf[K], VoiceProviderFields>>;
} = {
  tts: {
    gemini: { secrets: [], options: ['model'] },
    polly: { secrets: ['accessKeyId'], options: ['region'] },
    playht: { secrets: ['userId'], options: [] },
    azure: { secrets: [], options: ['region'] },
    custom: { secrets: [], options: ['baseURL', 'model'] },
  },
  stt: {
    azure: { secrets: [], options: ['region'] },
    custom: { secrets: [], options: ['baseURL', 'model'] },
  },
};

export function voiceProviderFields<K extends VoiceKind>(
  kind: K,
  id: VoiceIdOf[K],
): VoiceProviderFields | undefined {
  const table: Partial<Record<VoiceIdOf[K], VoiceProviderFields>> = VOICE_PROVIDER_FIELDS[kind];
  return table[id];
}
