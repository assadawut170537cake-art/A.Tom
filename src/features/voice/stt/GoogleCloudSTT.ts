import { ProviderError } from '../../../core/http/errors';
import { request, requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE, audioExtension } from '../core/STTInterface';

const ENDPOINT = 'https://speech.googleapis.com/v1/speech:recognize';

/** Google Speech v1 accepts these containers; AAC/.m4a (expo-audio's default) is not one of them. */
const ENCODINGS: Record<string, string> = {
  wav: 'LINEAR16',
  flac: 'FLAC',
  ogg: 'OGG_OPUS',
  webm: 'WEBM_OPUS',
  mp3: 'MP3',
  amr: 'AMR',
};

interface RecognizeResponse {
  results?: { alternatives?: { transcript?: string }[] }[];
}

/** Google Cloud Speech-to-Text v1 synchronous recognize (audio up to ~1 minute). */
export class GoogleCloudSTT extends BaseCloudSTT {
  readonly id = 'google' as const;
  readonly name = 'Google Cloud STT';

  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.secret(), 'Content-Type': 'application/json' };
  }

  async transcribe(audioUri: string): Promise<string> {
    const ext = audioExtension(audioUri);
    const encoding = ENCODINGS[ext];
    if (!encoding) {
      throw new ProviderError(this.id, 'unsupported', `ไม่รองรับไฟล์เสียง .${ext} (ใช้ wav/flac/ogg)`);
    }
    const file = this.audioFile(audioUri);
    const data = await requestJson<RecognizeResponse>(this.id, ENDPOINT, {
      method: 'POST',
      headers: await this.headers(),
      timeoutMs: 120_000,
      body: JSON.stringify({
        config: { languageCode: STT_LANGUAGE, encoding, enableAutomaticPunctuation: true },
        audio: { content: await file.base64() },
      }),
    });
    return this.requireText(
      data.results?.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ')
    );
  }

  /** Empty audio is rejected with 400 when the key is valid; a bad key is mapped to auth. */
  protected async probe(): Promise<unknown> {
    return request(this.id, ENDPOINT, {
      method: 'POST',
      headers: await this.headers(),
      acceptStatus: [400],
      body: JSON.stringify({ config: { languageCode: STT_LANGUAGE }, audio: { content: '' } }),
    });
  }
}
