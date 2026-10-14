import { voiceRegistry, type VoiceRegistry } from './core/VoiceRegistry';
import { AssemblyAISTT } from './stt/AssemblyAISTT';
import { AzureSTT } from './stt/AzureSTT';
import { CustomSTT } from './stt/CustomSTT';
import { DeepgramSTT } from './stt/DeepgramSTT';
import { ExpoSpeechSTT } from './stt/ExpoSpeechSTT';
import { GoogleCloudSTT } from './stt/GoogleCloudSTT';
import { RevAISTT } from './stt/RevAISTT';
import { WhisperSTT } from './stt/WhisperSTT';
import { AzureTTS } from './tts/AzureTTS';
import { CustomTTS } from './tts/CustomTTS';
import { ElevenLabsTTS } from './tts/ElevenLabsTTS';
import { ExpoSpeechTTS } from './tts/ExpoSpeechTTS';
import { GeminiTTS } from './tts/GeminiTTS';
import { GoogleCloudTTS } from './tts/GoogleCloudTTS';
import { OpenAITTS } from './tts/OpenAITTS';
import { PlayHTTTS } from './tts/PlayHTTTS';
import { PollyTTS } from './tts/PollyTTS';

/** Registers all 9 TTS + 8 STT providers (idempotent). Call once at app start. */
export function registerVoiceProviders(registry: VoiceRegistry = voiceRegistry): VoiceRegistry {
  [
    new ExpoSpeechTTS(),
    new GeminiTTS(),
    new OpenAITTS(),
    new ElevenLabsTTS(),
    new GoogleCloudTTS(),
    new AzureTTS(),
    new PollyTTS(),
    new PlayHTTTS(),
    new CustomTTS(),
  ].forEach((p) => registry.registerTTS(p));
  [
    new ExpoSpeechSTT(),
    new WhisperSTT(),
    new DeepgramSTT(),
    new GoogleCloudSTT(),
    new AzureSTT(),
    new AssemblyAISTT(),
    new RevAISTT(),
    new CustomSTT(),
  ].forEach((p) => registry.registerSTT(p));
  return registry;
}

export type * from './core/types';
