import { GeminiAdapter } from './adapters/GeminiAdapter';
import { JevAdapter } from './adapters/JevAdapter';
import { OpenAICompatibleAdapter } from './adapters/OpenAICompatibleAdapter';
import { OpenRouterAdapter } from './adapters/OpenRouterAdapter';
import { aiOrchestrator } from './core/Orchestrator';
import { aiRegistry, type ProviderRegistry } from './core/ProviderRegistry';
import type { AIProvider, AIProviderConfig } from './core/types';
import { PROVIDERS } from './providers.config';

export function createProvider(config: AIProviderConfig): AIProvider {
  switch (config.type) {
    case 'gemini':
      return new GeminiAdapter(config);
    case 'systemone':
      return new JevAdapter(config);
    case 'openai-compatible':
      return config.id === 'openrouter'
        ? new OpenRouterAdapter(config)
        : new OpenAICompatibleAdapter(config);
    case 'custom':
      return new OpenAICompatibleAdapter(config);
  }
}

/** Registers every provider from providers.config (idempotent). Call once at app start. */
export function registerAIProviders(registry: ProviderRegistry = aiRegistry): ProviderRegistry {
  for (const config of PROVIDERS) registry.register(createProvider(config));
  return registry;
}

export { aiOrchestrator, aiRegistry, PROVIDERS };
export type * from './core/types';
