import { ProviderError } from '../../../core/http/errors';
import { request, requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE_SHORT } from '../core/STTInterface';

const BASE = 'https://api.rev.ai/speechtotext/v1';

interface Job {
  id: string;
  status: 'in_progress' | 'transcribed' | 'failed';
  failure_detail?: string;
}

/** Rev AI async API: submit job (multipart) → poll → fetch plain-text transcript. */
export class RevAISTT extends BaseCloudSTT {
  readonly id = 'revai' as const;
  readonly name = 'Rev AI';

  private async auth(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.secret()}` };
  }

  async transcribe(audioUri: string): Promise<string> {
    const file = this.audioFile(audioUri);
    const headers = await this.auth();

    const form = new FormData();
    form.append('media', file, file.name);
    form.append('options', JSON.stringify({ language: STT_LANGUAGE_SHORT }));
    const job = await requestJson<Job>(this.id, `${BASE}/jobs`, {
      method: 'POST',
      headers,
      body: form,
      timeoutMs: 120_000,
    });

    await this.poll(async () => {
      const j = await requestJson<Job>(this.id, `${BASE}/jobs/${job.id}`, { headers });
      if (j.status === 'failed') {
        throw new ProviderError(this.id, 'invalid_response', j.failure_detail ?? 'ถอดเสียงไม่สำเร็จ');
      }
      return j.status === 'transcribed' ? j : undefined;
    });

    const res = await request(this.id, `${BASE}/jobs/${job.id}/transcript`, {
      headers: { ...headers, Accept: 'text/plain' },
    });
    // Plain-text format prefixes each paragraph with "Speaker N    00:00:00    "
    const text = (await res.text())
      .split('\n')
      .map((line) => line.split(/\s{2,}|\t/).pop() ?? '')
      .join(' ');
    return this.requireText(text);
  }

  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${BASE}/account`, { headers: await this.auth() });
  }
}
