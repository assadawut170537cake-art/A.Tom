import { requestBytes, requestJson } from '../../../core/http/request';
import { BaseCloudTTS, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, TTSProviderId, Voice } from '../core/types';

const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
];

/** OpenAI /audio/speech. CustomTTS reuses it for any OpenAI-compatible server. */
export class OpenAITTS extends BaseCloudTTS {
  readonly id: TTSProviderId = 'openai';
  readonly name: string = 'OpenAI TTS';

  protected async baseURL(): Promise<string> {
    return 'https://api.openai.com/v1';
  }

  protected async model(): Promise<string> {
    return 'gpt-4o-mini-tts';
  }

  protected async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.secret()}`, 'Content-Type': 'application/json' };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const data = await requestBytes(this.id, `${await this.baseURL()}/audio/speech`, {
      method: 'POST',
      headers: await this.headers(),
      timeoutMs: 60_000,
      body: JSON.stringify({
        model: await this.model(),
        input: text,
        voice: opts.voiceId ?? 'alloy',
        speed: opts.speed,
        response_format: 'mp3',
      }),
    });
    return { data, ext: 'mp3' };
  }

  /** The voice list is fixed; the API has no endpoint for it. */
  protected async fetchVoices(): Promise<Voice[]> {
    return OPENAI_VOICES.map((v) => ({ id: v, name: v }));
  }

  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${await this.baseURL()}/models`, { headers: await this.headers() });
  }
}
