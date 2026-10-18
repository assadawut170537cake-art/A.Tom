import { File } from 'expo-file-system';

import { ProviderError, testWith } from '../../../core/http/errors';
import { sleep } from '../../../core/http/request';
import { providerOption, providerSecret } from './credentials';
import type { STTProvider, STTProviderId } from './types';

/** Default recognition language (BCP-47) and its short ISO-639-1 form. */
export const STT_LANGUAGE = 'th-TH';
export const STT_LANGUAGE_SHORT = 'th';

/** Lower-case file extension of an audio URI ('' when there is none); query strings ignored. */
export function audioExtension(uri: string): string {
  const path = uri.split('?')[0] ?? '';
  return path.split('.').pop()?.toLowerCase() ?? '';
}

/** Recordings from expo-audio's default presets are AAC in an .m4a container. */
export function audioMimeType(uri: string): string {
  switch (audioExtension(uri)) {
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

  protected secret(field?: string): Promise<string> {
    return providerSecret('stt', this.id, field);
  }

  protected option(name: string, fallback?: string): Promise<string> {
    return providerOption('stt', this.id, name, fallback);
  }

  protected audioFile(audioUri: string): File {
    const file = new File(audioUri);
    if (!file.exists) throw new ProviderError(this.id, 'bad_request', `ไม่พบไฟล์เสียง: ${audioUri}`);
    return file;
  }

  /**
   * ไฟล์เสียงสำหรับ `FormData` แบบที่ React Native ส่งได้จริง: `{ uri, name, type }`
   *
   * ทำไมไม่ append `File` ของ expo-file-system ตรง ๆ: fetch ของ RN (XHR) อ่านเฉพาะ part ที่มี `uri`
   * เป็น own property — `File` เก็บ `uri` ไว้ใน prototype จึงไม่ถูกส่งเป็นไฟล์ แล้วคำขอค้างจนหมดเวลา
   * (เจอบนเครื่องจริง: Whisper "หมดเวลา (120s)") · Blob ใน Node/Jest ไม่มีปัญหานี้ test เลยไม่จับ
   */
  protected audioFormPart(audioUri: string): Blob {
    const file = this.audioFile(audioUri);
    const part = { uri: file.uri, name: file.name, type: audioMimeType(file.uri) };
    // Cast: type ของ FormData.append รับแค่ string | Blob แต่ RN รองรับ object { uri, name, type } (trust boundary ของ native networking)
    return part as unknown as Blob;
  }

  /** Polls an async job until `check` returns a value (or throws), up to `timeoutMs`. */
  protected async poll<T>(
    check: () => Promise<T | undefined>,
    { intervalMs = 1500, timeoutMs = 120_000 } = {}
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await check();
      if (result !== undefined) return result;
      if (Date.now() > deadline) {
        throw new ProviderError(this.id, 'timeout', `ถอดเสียงนานเกิน ${timeoutMs / 1000}s`);
      }
      await sleep(intervalMs);
    }
  }

  /** Throws a non-fallback error when the provider returned no text. */
  protected requireText(text: string | undefined | null): string {
    const trimmed = text?.trim();
    if (!trimmed) throw new ProviderError(this.id, 'invalid_response', 'ไม่ได้ยินเสียงพูด');
    return trimmed;
  }
}
