import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE_SHORT } from '../core/STTInterface';

const BASE = 'https://api.assemblyai.com/v2';

interface Transcript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string | null;
  error?: string;
}

/** AssemblyAI async API: upload → create transcript → poll until completed. */
export class AssemblyAISTT extends BaseCloudSTT {
  readonly id = 'assemblyai' as const;
  readonly name = 'AssemblyAI';

  private async auth(): Promise<Record<string, string>> {
    return { authorization: await this.secret() };
  }

  async transcribe(audioUri: string): Promise<string> {
    const file = this.audioFile(audioUri);
    const headers = await this.auth();

    const { upload_url } = await requestJson<{ upload_url: string }>(this.id, `${BASE}/upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: await file.bytes(),
      timeoutMs: 120_000,
    });

    const job = await requestJson<Transcript>(this.id, `${BASE}/transcript`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url, language_code: STT_LANGUAGE_SHORT }),
    });

    const done = await this.poll(async () => {
      const t = await requestJson<Transcript>(this.id, `${BASE}/transcript/${job.id}`, { headers });
      if (t.status === 'error') {
        throw new ProviderError(this.id, 'invalid_response', t.error ?? 'ถอดเสียงไม่สำเร็จ');
      }
      return t.status === 'completed' ? t : undefined;
    });
    return this.requireText(done.text);
  }

  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${BASE}/transcript?limit=1`, { headers: await this.auth() });
  }
}
