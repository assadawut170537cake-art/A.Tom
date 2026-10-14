import { signV4 } from '../../../core/crypto/sigv4';
import { requestBytes, requestJson } from '../../../core/http/request';
import {
  BaseCloudTTS,
  escapeXml,
  ssmlProsody,
  toGender,
  type SynthesizedAudio,
} from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';

/** Polly has no Thai voice; Joanna (neural, en-US) is the safe default. */
const DEFAULT_VOICE = 'Joanna';

interface DescribeVoicesResponse {
  Voices?: { Id: string; Name: string; LanguageCode?: string; Gender?: string }[];
}

/**
 * Amazon Polly REST API, signed with SigV4 (no AWS SDK).
 * Secrets: secretKey('tts','polly') = secret access key, secretKey('tts','polly','accessKeyId').
 * Option (ProviderSettings 'tts.polly'): region (default us-east-1).
 */
export class PollyTTS extends BaseCloudTTS {
  readonly id = 'polly' as const;
  readonly name = 'Amazon Polly';

  private async signed(method: 'GET' | 'POST', path: string, body?: string) {
    const region = await this.option('region', 'us-east-1');
    const url = `https://polly.${region}.amazonaws.com${path}`;
    const headers = signV4(
      {
        method,
        url,
        region,
        service: 'polly',
        body,
        headers: body ? { 'content-type': 'application/json' } : {},
      },
      { accessKeyId: await this.secret('accessKeyId'), secretAccessKey: await this.secret() }
    );
    return { url, init: { method, headers, ...(body !== undefined && { body }) } };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const prosody = ssmlProsody(opts);
    const body = JSON.stringify({
      OutputFormat: 'mp3',
      VoiceId: opts.voiceId ?? DEFAULT_VOICE,
      Engine: 'neural',
      ...(prosody
        ? { TextType: 'ssml', Text: `<speak><prosody ${prosody}>${escapeXml(text)}</prosody></speak>` }
        : { TextType: 'text', Text: text }),
    });
    const { url, init } = await this.signed('POST', '/v1/speech', body);
    const data = await requestBytes(this.id, url, { ...init, timeoutMs: 60_000 });
    return { data, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const { url, init } = await this.signed('GET', '/v1/voices');
    const data = await requestJson<DescribeVoicesResponse>(this.id, url, init);
    return (data.Voices ?? []).map((v) => ({
      id: v.Id,
      name: v.Name,
      language: v.LanguageCode,
      gender: toGender(v.Gender),
    }));
  }
}
