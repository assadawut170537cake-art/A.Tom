import type { TTSProviderId } from '../core/types';
import { OpenAITTS } from './OpenAITTS';

/**
 * Any OpenAI-compatible /audio/speech server.
 * Options (ProviderSettings 'tts.custom'): baseURL (required, e.g. http://host:8000/v1), model.
 */
export class CustomTTS extends OpenAITTS {
  readonly id: TTSProviderId = 'custom';
  readonly name: string = 'Custom (OpenAI-compatible)';

  protected async baseURL(): Promise<string> {
    return (await this.option('baseURL')).replace(/\/+$/, '');
  }

  protected model(): Promise<string> {
    return this.option('model', 'tts-1');
  }
}
