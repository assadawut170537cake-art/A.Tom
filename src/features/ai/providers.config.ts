import type { AIProviderConfig } from './core/types';

export const PROVIDERS: AIProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3-flash',
    models: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    enabled: true,
    purpose: 'llm',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.6',
    models: 'dynamic',
    enabled: true,
    purpose: 'llm',
  },
  {
    id: 'jev',
    name: 'Jev (TypeSafe)',
    type: 'systemone',
    baseURL: 'https://api.typesafe.ai',
    defaultModel: 'jev-latest',
    models: ['jev-latest', 'jev-preview'],
    enabled: false,
    purpose: 'router',
  },
];
