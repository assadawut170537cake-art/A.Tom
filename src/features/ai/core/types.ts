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
  /**
   * รุ่นสำรองของเจ้าเดียวกันเมื่อโมเดลที่เลือก "โควต้าหมด" — โควต้าฟรีนับแยกต่อโมเดล จึงสลับรุ่นแล้วคุยต่อได้
   * เรียงจากตัวที่อยากใช้ก่อน · ไม่มี = ไปเจ้าถัดไปเลย (ADR-017)
   */
  quotaFallbackModels?: string[];
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
  /** รายชื่อโมเดลสำหรับแสดง — ถ้าดึงสดไม่ได้ provider บางตัวคืนรายการใน config แทน */
  getModels(): Promise<string[]>;
  /**
   * ดึงรายชื่อโมเดลสด ๆ จาก API ของผู้ให้บริการ (ต้องมี API key) — ไม่ fallback ไปรายการใน config
   * ล้ม → throw ProviderError (ข้อความไทย) ให้หน้าตั้งค่าแสดง แล้วให้บอสพิมพ์ชื่อเองได้
   * ไม่มี = provider นี้ไม่มี endpoint รายชื่อโมเดล
   */
  listModels?(): Promise<string[]>;
}
