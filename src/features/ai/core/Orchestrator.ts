import { ProviderError, toProviderError, type ProviderErrorKind } from '../../../core/http/errors';
import { sleep } from '../../../core/http/request';
import {
  ProviderSettings,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import { aiRegistry, type ProviderRegistry } from './ProviderRegistry';
import type { AIProvider, AIProviderId, ChatRequest, ChatResponse } from './types';

/** Failures worth retrying on the same provider (auth/missing key never fix themselves). */
const RETRYABLE = new Set<ProviderErrorKind>(['rate_limit', 'server', 'timeout', 'network']);
const RETRY_DELAY_MS = 800;

export interface OrchestratorChatInput extends Omit<ChatRequest, 'model'> {
  /** Pin a provider; it is tried first, the rest of the chain is still used as fallback. */
  providerId?: AIProviderId;
  /** Model override for the pinned provider only (models are provider-specific). */
  model?: string;
}

/**
 * Routes chat requests across LLM providers in priority order:
 * last successful provider → user priority (ProviderSettings) → registration order.
 * Falls back on 401/403/429/5xx/timeout/network/missing key; other errors (e.g. 400) are thrown.
 * Advanced settings: timeoutMs per request, retries on the same provider, fallback on/off.
 */
export class Orchestrator {
  private lastGood: AIProviderId | null = null;

  constructor(
    private readonly registry: ProviderRegistry = aiRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings
  ) {}

  async chat(input: OrchestratorChatInput): Promise<ChatResponse> {
    const { providerId: pinned, model: pinnedModel, ...rest } = input;
    const chain = await this.providerChain(pinned);
    if (!chain.length) {
      throw new ProviderError('orchestrator', 'missing_key', 'ไม่มีผู้ให้บริการ AI ที่เปิดใช้งาน');
    }

    const { timeoutMs, retries, fallback } = await this.settings.getAdvanced();
    const failures: string[] = [];
    for (const provider of fallback ? chain : chain.slice(0, 1)) {
      const id = provider.config.id;
      const model =
        (id === pinned && pinnedModel) ||
        (await this.settings.getModelFor(id)) ||
        provider.config.defaultModel;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await provider.chat({ timeoutMs, ...rest, model });
          this.lastGood = id;
          return res;
        } catch (e) {
          const err = toProviderError(id, e);
          if (!err.shouldFallback) throw err;
          if (attempt < retries && RETRYABLE.has(err.kind)) {
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          if (this.lastGood === id) this.lastGood = null;
          failures.push(err.message);
          break;
        }
      }
    }
    throw new ProviderError(
      'orchestrator',
      'server',
      `ผู้ให้บริการทุกรายล้มเหลว:\n${failures.join('\n')}`
    );
  }

  /** First provider that would be tried right now, or undefined if none is enabled. */
  async pickProvider(): Promise<AIProvider | undefined> {
    return (await this.providerChain())[0];
  }

  private async providerChain(pinned?: AIProviderId): Promise<AIProvider[]> {
    const all = this.registry.list().filter((p) => (p.config.purpose ?? 'llm') === 'llm');
    const enabled: AIProvider[] = [];
    for (const p of all) {
      const override = await this.settings.getEnabled(p.config.id);
      if (override ?? p.config.enabled) enabled.push(p);
    }

    const priority = await this.settings.getPriority();
    const rank = (id: AIProviderId) => {
      if (id === pinned) return -2;
      if (id === this.lastGood) return -1;
      const i = priority.indexOf(id);
      return i === -1 ? priority.length + all.findIndex((p) => p.config.id === id) : i;
    };
    return enabled.sort((a, b) => rank(a.config.id) - rank(b.config.id));
  }
}

export const aiOrchestrator = new Orchestrator();
