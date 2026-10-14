import { requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE_SHORT, audioMimeType } from '../core/STTInterface';

const BASE = 'https://api.deepgram.com/v1';

interface ListenResponse {
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}

export class DeepgramSTT extends BaseCloudSTT {
  readonly id = 'deepgram' as const;
  readonly name = 'Deepgram';

  private async auth(): Promise<Record<string, string>> {
    return { Authorization: `Token ${await this.secret()}` };
  }

  async transcribe(audioUri: string): Promise<string> {
    const file = this.audioFile(audioUri);
    const params = `model=nova-2&language=${STT_LANGUAGE_SHORT}&smart_format=true`;
    const data = await requestJson<ListenResponse>(this.id, `${BASE}/listen?${params}`, {
      method: 'POST',
      headers: { ...(await this.auth()), 'Content-Type': audioMimeType(audioUri) },
      body: await file.bytes(),
      timeoutMs: 120_000,
    });
    return this.requireText(data.results?.channels?.[0]?.alternatives?.[0]?.transcript);
  }

  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${BASE}/projects`, { headers: await this.auth() });
  }
}
