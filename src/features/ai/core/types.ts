import type { AIProviderId } from '../../../core/types/aiProvider';

// ย้ายไป core/types แล้ว — re-export ไว้ให้ไฟล์ใน features/ai import จากที่เดิมได้
export type { AIProviderId } from '../../../core/types/aiProvider';

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
  /** Per-request timeout; adapters fall back to the HTTP default when omitted. */
  timeoutMs?: number | undefined;
}

export interface ChatResponse {
  content: string;
  model: string;
  providerId: AIProviderId;
  tokensUsed?: { input: number; output: number } | undefined;
  error?: string;
}

export interface AIProvider {
  config: AIProviderConfig;
  chat(req: ChatRequest): Promise<ChatResponse>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  getModels(): Promise<string[]>;
}
