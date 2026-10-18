import { requestJson } from '../../../core/http/request';
import type { ChatRequest } from '../core/types';
import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter';

/** OpenRouter app-attribution headers (https://openrouter.ai/docs). */
const APP_URL = 'https://github.com/assadawut170537cake-art/A.Tom';
const APP_TITLE = 'A.T.O.M.';

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  protected override extraHeaders(): Record<string, string> {
    return { 'HTTP-Referer': APP_URL, 'X-Title': APP_TITLE };
  }

  /** ค้นเว็บผ่าน web plugin ของ OpenRouter (คิดเงินเพิ่ม — Orchestrator เปิดเมื่อบอสเปิด webSearchPaid) */
  protected override extraBody(req: ChatRequest): Record<string, unknown> {
    return req.webSearch ? { plugins: [{ id: 'web' }] } : {};
  }

  /** /models is public on OpenRouter, so validate the key against /key instead. */
  protected override async probe(): Promise<unknown> {
    return requestJson(this.config.id, this.url('/key'), { headers: await this.headers() });
  }
}
