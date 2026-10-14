export type AIProviderId = 'gemini' | 'openrouter' | 'jev' | 'custom';
export type AIProviderType = 'openai-compatible' | 'gemini' | 'systemone' | 'custom';

export interface AIProviderConfig {
  id: AIProviderId;
  name: string;
  type: AIProviderType;
  baseURL: string;
  defaultModel: string;
  models: string[] | 'dynamic';
  enabled: boolean;
  purpose?: 'llm' | 'router';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  providerId: AIProviderId;
  tokensUsed?: { input: number; output: number };
  error?: string;
}

export interface AIProvider {
  config: AIProviderConfig;
  chat(req: ChatRequest): Promise<ChatResponse>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  getModels(): Promise<string[]>;
}
