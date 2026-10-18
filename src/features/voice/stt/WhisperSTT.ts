import { requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE_SHORT } from '../core/STTInterface';
import type { STTProviderId } from '../core/types';

/** OpenAI /audio/transcriptions. CustomSTT reuses it for any OpenAI-compatible server. */
export class WhisperSTT extends BaseCloudSTT {
  readonly id: STTProviderId = 'whisper';
  readonly name: string = 'OpenAI Whisper';

  protected async baseURL(): Promise<string> {
    return 'https://api.openai.com/v1';
  }

  protected async model(): Promise<string> {
    return 'whisper-1';
  }

  protected async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.secret()}` };
  }

  async transcribe(audioUri: string): Promise<string> {
    const form = new FormData();
    form.append('file', this.audioFormPart(audioUri));
    form.append('model', await this.model());
    form.append('language', STT_LANGUAGE_SHORT);
    form.append('response_format', 'json');

    const data = await requestJson<{ text?: string }>(
      this.id,
      `${await this.baseURL()}/audio/transcriptions`,
      { method: 'POST', headers: await this.authHeaders(), body: form, timeoutMs: 120_000 }
    );
    return this.requireText(data.text);
  }

  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${await this.baseURL()}/models`, {
      headers: await this.authHeaders(),
    });
  }
}
