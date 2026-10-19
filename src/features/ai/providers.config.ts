import type { AIProviderConfig } from './core/types';

/** Dahl เป็น OpenAI-compatible — โมเดลละ provider เพราะบอสได้ key แยกต่อโมเดล */
export const DAHL_BASE_URL = 'https://inference.dahl.global/v1';

/**
 * ปิดไว้ก่อน (ยังไม่มี key = ถ้าเปิดจะไปโผล่ในข้อความ error ทุกครั้งที่ตัวอื่นล้ม) · เปิดได้ที่ ตั้งค่า › AI
 * หรือเลือกเป็นโมเดลของ persona (เลือกแล้วเปิดให้เอง)
 */
const dahl = (id: AIProviderConfig['id'], name: string, model: string): AIProviderConfig => ({
  id,
  name,
  type: 'openai-compatible',
  baseURL: DAHL_BASE_URL,
  defaultModel: model,
  models: [model],
  enabled: false,
  purpose: 'llm',
});

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
  dahl('dahl-minimax', 'Dahl · MiniMax M2.7', 'MiniMaxAI/MiniMax-M2.7'),
  dahl('dahl-deepseek', 'Dahl · DeepSeek V4 Flash', 'deepseek-ai/DeepSeek-V4-Flash-0731'),
  dahl('dahl-glm', 'Dahl · GLM 5.3 Flash', 'zai-org/GLM-5.3-Flash'),
];
