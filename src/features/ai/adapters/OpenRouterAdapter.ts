import { requestJson } from '../../../core/http/request';
import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter';

/** OpenRouter app-attribution headers (https://openrouter.ai/docs). */
const APP_URL = 'https://github.com/assadawut170537cake-art/A.Tom';
const APP_TITLE = 'A.T.O.M.';

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  protected override extraHeaders(): Record<string, string> {
    return { 'HTTP-Referer': APP_URL, 'X-Title': APP_TITLE };
  }

  /** /models is public on OpenRouter, so validate the key against /key instead. */
  protected override async probe(): Promise<unknown> {
    return requestJson(this.config.id, this.url('/key'), { headers: await this.headers() });
  }
}
