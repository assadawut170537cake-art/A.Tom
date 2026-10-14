import { requestBytes, requestJson } from '../../../core/http/request';
import { BaseCloudTTS, toGender, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';

const BASE = 'https://api.play.ht/api/v2';
const DEFAULT_VOICE =
  's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json';

interface PlayHTVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

/**
 * Play.ht v2 API. Secrets: secretKey('tts','playht') = API secret, secretKey('tts','playht','userId').
 * NOTE: api.play.ht was unreachable when this was written (Oct 2026); kept per the v2 API docs.
 */
export class PlayHTTTS extends BaseCloudTTS {
  readonly id = 'playht' as const;
  readonly name = 'Play.ht';

  private async headers(): Promise<Record<string, string>> {
    return {
      AUTHORIZATION: await this.secret(),
      'X-USER-ID': await this.secret('userId'),
      'Content-Type': 'application/json',
    };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const data = await requestBytes(this.id, `${BASE}/tts/stream`, {
      method: 'POST',
      headers: { ...(await this.headers()), Accept: 'audio/mpeg' },
      timeoutMs: 60_000,
      body: JSON.stringify({
        text,
        voice: opts.voiceId ?? DEFAULT_VOICE,
        voice_engine: 'Play3.0-mini',
        output_format: 'mp3',
        speed: opts.speed,
      }),
    });
    return { data, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const voices = await requestJson<PlayHTVoice[]>(this.id, `${BASE}/voices`, {
      headers: await this.headers(),
    });
    return voices.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
      gender: toGender(v.gender),
    }));
  }
}
