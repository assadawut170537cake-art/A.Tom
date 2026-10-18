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
  /** ให้ provider ค้นเว็บประกอบคำตอบ (Gemini: Google Search · OpenRouter: web plugin) */
  webSearch?: boolean | undefined;
}

/** ข้อความสะสมทั้งหมดจนถึงตอนนี้ (ไม่ใช่แค่ส่วนที่เพิ่ม) — '' = เริ่มใหม่ (provider ถัดไปใน fallback) */
export type PartialTextListener = (text: string) => void;

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
  /** ตอบแบบไหลทีละส่วน — ไม่มี = provider นี้ตอบได้แค่ทั้งก้อน (Orchestrator ใช้ chat() แทน) */
  chatStream?(req: ChatRequest, onText: PartialTextListener): Promise<ChatResponse>;
}
