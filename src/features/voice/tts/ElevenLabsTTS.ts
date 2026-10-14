import { requestBytes, requestJson } from '../../../core/http/request';
import { BaseCloudTTS, toGender, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';

const BASE = 'https://api.elevenlabs.io/v1';
/** "Rachel" — a premade voice available on every account. */
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

interface VoicesResponse {
  voices?: { voice_id: string; name: string; labels?: { gender?: string; language?: string } }[];
}

export class ElevenLabsTTS extends BaseCloudTTS {
  readonly id = 'elevenlabs' as const;
  readonly name = 'ElevenLabs';

  private async headers(): Promise<Record<string, string>> {
    return { 'xi-api-key': await this.secret(), 'Content-Type': 'application/json' };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const voice = encodeURIComponent(opts.voiceId ?? DEFAULT_VOICE);
    const data = await requestBytes(
      this.id,
      `${BASE}/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { ...(await this.headers()), Accept: 'audio/mpeg' },
        timeoutMs: 60_000,
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          ...(opts.speed && { voice_settings: { speed: opts.speed } }),
        }),
      }
    );
    return { data, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const data = await requestJson<VoicesResponse>(this.id, `${BASE}/voices`, {
      headers: await this.headers(),
    });
    return (data.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language,
      gender: toGender(v.labels?.gender),
    }));
  }
}
