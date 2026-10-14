import { ProviderError, testWith } from '../../../core/http/errors';
import { SecureKeyStore, secretKey, type KeyStore } from '../../../core/storage/SecureKeyStore';
import type { AIProvider, AIProviderConfig, ChatRequest, ChatResponse } from './types';

export type { AIProvider } from './types';

/**
 * Shared plumbing for AI adapters: API-key lookup from SecureKeyStore and a uniform testConnection.
 * Adapters only implement chat() and the cheap authenticated probe used by testConnection().
 */
export abstract class BaseAIProvider implements AIProvider {
  constructor(
    readonly config: AIProviderConfig,
    protected readonly keys: KeyStore = SecureKeyStore
  ) {}

  abstract chat(req: ChatRequest): Promise<ChatResponse>;

  /** Cheapest authenticated request that proves the key and endpoint work. */
  protected abstract probe(): Promise<unknown>;

  testConnection(): Promise<{ ok: boolean; error?: string }> {
    return testWith(this.config.id, () => this.probe());
  }

  async getModels(): Promise<string[]> {
    return this.config.models === 'dynamic' ? [this.config.defaultModel] : [...this.config.models];
  }

  protected async apiKey(): Promise<string> {
    const key = await this.keys.get(secretKey('ai', this.config.id));
    if (!key) throw new ProviderError(this.config.id, 'missing_key', 'ยังไม่ได้ตั้งค่า API key');
    return key;
  }

  protected url(path: string): string {
    return this.config.baseURL.replace(/\/+$/, '') + path;
  }
}
