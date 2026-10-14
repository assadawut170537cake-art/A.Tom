import { ProviderError } from '../../../core/http/errors';
import { request, requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE } from '../core/STTInterface';

/** The short-audio REST API only accepts WAV (PCM) and OGG (Opus). */
const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav; codecs=audio/pcm; samplerate=16000',
  ogg: 'audio/ogg; codecs=opus',
};

interface RecognitionResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
}

/** Azure AI Speech short-audio REST STT (≤60s). Option (ProviderSettings 'stt.azure'): region. */
export class AzureSTT extends BaseCloudSTT {
  readonly id = 'azure' as const;
  readonly name = 'Azure Speech';

  async transcribe(audioUri: string): Promise<string> {
    const ext = audioUri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) {
      throw new ProviderError(this.id, 'unsupported', `ไม่รองรับไฟล์เสียง .${ext} (ใช้ wav/ogg)`);
    }
    const file = this.audioFile(audioUri);
    const region = encodeURIComponent(await this.option('region'));
    const data = await requestJson<RecognitionResponse>(
      this.id,
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${STT_LANGUAGE}&format=simple`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': await this.secret(),
          'Content-Type': contentType,
          Accept: 'application/json',
        },
        body: await file.bytes(),
        timeoutMs: 90_000,
      }
    );
    if (data.RecognitionStatus && data.RecognitionStatus !== 'Success') {
      throw new ProviderError(this.id, 'invalid_response', `ถอดเสียงไม่สำเร็จ (${data.RecognitionStatus})`);
    }
    return this.requireText(data.DisplayText);
  }

  /** Token endpoint validates key + region cheaply. */
  protected async probe(): Promise<unknown> {
    const region = encodeURIComponent(await this.option('region'));
    return request(this.id, `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': await this.secret() },
    });
  }
}
