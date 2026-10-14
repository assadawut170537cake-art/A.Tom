import { File } from 'expo-file-system';

import { ProviderError, testWith } from '../../../core/http/errors';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import type { STTProvider, STTProviderId } from './types';

export type { STTProvider } from './types';

/** Default recognition language (BCP-47) and its short ISO-639-1 form. */
export const STT_LANGUAGE = 'th-TH';
export const STT_LANGUAGE_SHORT = 'th';

/** Recordings from expo-audio's default presets are AAC in an .m4a container. */
export function audioMimeType(uri: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mp4';
  }
}

/** Base for HTTP STT providers: credential lookup, file reading and a uniform testConnection. */
export abstract class BaseCloudSTT implements STTProvider {
  abstract readonly id: STTProviderId;
  abstract readonly name: string;

  abstract transcribe(audioUri: string): Promise<string>;
  /** Cheapest authenticated request that proves the credentials work. */
  protected abstract probe(): Promise<unknown>;

  testConnection(): Promise<{ ok: boolean; error?: string }> {
    return testWith(this.id, () => this.probe());
  }

  protected async secret(field?: string): Promise<string> {
    const value = await SecureKeyStore.get(secretKey('stt', this.id, field));
    if (!value) {
      throw new ProviderError(this.id, 'missing_key', `ยังไม่ได้ตั้งค่า ${field ?? 'API key'}`);
    }
    return value;
  }

  protected async option(name: string, fallback?: string): Promise<string> {
    const value = (await ProviderSettings.getOption(`stt.${this.id}`, name)) ?? fallback;
    if (!value) throw new ProviderError(this.id, 'missing_key', `ยังไม่ได้ตั้งค่า ${name}`);
    return value;
  }

  protected audioFile(audioUri: string): File {
    const file = new File(audioUri);
    if (!file.exists) throw new ProviderError(this.id, 'bad_request', `ไม่พบไฟล์เสียง: ${audioUri}`);
    return file;
  }

  /** Throws a non-fallback error when the provider returned no text. */
  protected requireText(text: string | undefined | null): string {
    const trimmed = text?.trim();
    if (!trimmed) throw new ProviderError(this.id, 'invalid_response', 'ไม่ได้ยินเสียงพูด');
    return trimmed;
  }
}
