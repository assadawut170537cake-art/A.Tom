import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { BaseCloudTTS, TTS_LANGUAGE, toGender, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';

const BASE = 'https://texttospeech.googleapis.com/v1';

interface SynthesizeResponse {
  audioContent?: string;
}

interface VoicesResponse {
  voices?: { name: string; languageCodes?: string[]; ssmlGender?: string }[];
}

export class GoogleCloudTTS extends BaseCloudTTS {
  readonly id = 'google' as const;
  readonly name = 'Google Cloud TTS';

  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.secret(), 'Content-Type': 'application/json' };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const data = await requestJson<SynthesizeResponse>(this.id, `${BASE}/text:synthesize`, {
      method: 'POST',
      headers: await this.headers(),
      timeoutMs: 60_000,
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: TTS_LANGUAGE, ...(opts.voiceId && { name: opts.voiceId }) },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: opts.speed,
          // SpeakOptions.pitch is a multiplier (1 = normal); Google wants semitones in [-20, 20]
          pitch:
            opts.pitch != null
              ? Math.max(-20, Math.min(20, Math.round((opts.pitch - 1) * 200) / 10))
              : undefined,
        },
      }),
    });
    if (!data.audioContent) throw new ProviderError(this.id, 'invalid_response', 'ไม่มีเสียงในคำตอบ');
    return { data: { base64: data.audioContent }, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const data = await requestJson<VoicesResponse>(
      this.id,
      `${BASE}/voices?languageCode=${TTS_LANGUAGE}`,
      { headers: await this.headers() }
    );
    return (data.voices ?? []).map((v) => ({
      id: v.name,
      name: v.name,
      language: v.languageCodes?.[0],
      gender: toGender(v.ssmlGender),
    }));
  }
}
