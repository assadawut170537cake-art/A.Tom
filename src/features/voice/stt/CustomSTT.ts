import type { STTProviderId } from '../core/types';
import { WhisperSTT } from './WhisperSTT';

/**
 * Any OpenAI-compatible /audio/transcriptions server (e.g. a self-hosted faster-whisper).
 * Options (ProviderSettings 'stt.custom'): baseURL (required), model.
 */
export class CustomSTT extends WhisperSTT {
  readonly id: STTProviderId = 'custom';
  readonly name: string = 'Custom';

  protected async baseURL(): Promise<string> {
    return (await this.option('baseURL')).replace(/\/+$/, '');
  }

  protected model(): Promise<string> {
    return this.option('model', 'whisper-1');
  }
}
