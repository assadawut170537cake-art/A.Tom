import { request, requestBytes, requestJson } from '../../../core/http/request';
import {
  BaseCloudTTS,
  TTS_LANGUAGE,
  escapeXml,
  ssmlProsody,
  toGender,
  type SynthesizedAudio,
} from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';

const DEFAULT_VOICE = 'th-TH-PremwadeeNeural';

interface AzureVoice {
  ShortName: string;
  DisplayName?: string;
  LocalName?: string;
  Locale?: string;
  Gender?: string;
}

/** Azure AI Speech REST TTS. Option (ProviderSettings 'tts.azure'): region, e.g. southeastasia. */
export class AzureTTS extends BaseCloudTTS {
  readonly id = 'azure' as const;
  readonly name = 'Azure Speech';

  private async endpoint(path: string): Promise<string> {
    const region = await this.option('region');
    return `https://${encodeURIComponent(region)}.tts.speech.microsoft.com${path}`;
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const voice = opts.voiceId ?? DEFAULT_VOICE;
    const prosody = ssmlProsody(opts);
    const body = escapeXml(text);
    const ssml =
      `<speak version="1.0" xml:lang="${TTS_LANGUAGE}"><voice name="${escapeXml(voice)}">` +
      (prosody ? `<prosody ${prosody}>${body}</prosody>` : body) +
      '</voice></speak>';

    const data = await requestBytes(this.id, await this.endpoint('/cognitiveservices/v1'), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': await this.secret(),
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'atom',
      },
      timeoutMs: 60_000,
      body: ssml,
    });
    return { data, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const voices = await requestJson<AzureVoice[]>(
      this.id,
      await this.endpoint('/cognitiveservices/voices/list'),
      { headers: { 'Ocp-Apim-Subscription-Key': await this.secret() } }
    );
    return voices
      .filter((v) => v.Locale === TTS_LANGUAGE)
      .map((v) => ({
        id: v.ShortName,
        name: v.LocalName ?? v.DisplayName ?? v.ShortName,
        language: v.Locale,
        gender: toGender(v.Gender),
      }));
  }

  /** Token endpoint validates key + region without listing every voice. */
  protected async probe(): Promise<unknown> {
    const region = await this.option('region');
    return request(
      this.id,
      `https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': await this.secret() } }
    );
  }
}
