import type { AIProvider, AIProviderId } from './types';

export class ProviderRegistry {
  private readonly providers = new Map<AIProviderId, AIProvider>();

  /** Registering the same id again replaces the previous instance. */
  register(provider: AIProvider): void {
    this.providers.set(provider.config.id, provider);
  }

  get(id: AIProviderId): AIProvider | undefined {
    return this.providers.get(id);
  }

  /** In registration order. */
  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  /** Enabled by static config; user overrides from ProviderSettings are applied by the Orchestrator. */
  listEnabled(): AIProvider[] {
    return this.list().filter((p) => p.config.enabled);
  }
}

export const aiRegistry = new ProviderRegistry();
