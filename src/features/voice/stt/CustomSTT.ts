import type { STTProviderId } from '../core/types';
import { WhisperSTT } from './WhisperSTT';

/**
 * Any OpenAI-compatible /audio/transcriptions server (e.g. a self-hosted faster-whisper).
 * Options (ProviderSettings 'stt.custom'): baseURL (required), model.
 */
export class CustomSTT extends WhisperSTT {
  override readonly id: STTProviderId = 'custom';
  override readonly name: string = 'Custom';

  protected override async baseURL(): Promise<string> {
    return (await this.option('baseURL')).replace(/\/+$/, '');
  }

  protected override model(): Promise<string> {
    return this.option('model', 'whisper-1');
  }
}
