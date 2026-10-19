/**
 * @file id ของ AI provider — ใช้ร่วมกันระหว่าง core/storage (ProviderSettings) กับ features/ai
 * รายละเอียด config / adapter ยังอยู่ใน features/ai
 */

export type AIProviderId =
  | 'gemini'
  | 'openrouter'
  | 'jev'
  | 'custom'
  // Dahl (inference.dahl.global) — แยก provider ต่อโมเดล เพื่อให้แต่ละตัวมี key / ลำดับ / สลับกันเองได้ (Boss ขอ)
  | 'dahl-minimax'
  | 'dahl-deepseek'
  | 'dahl-glm'
  // xAI Grok — key เดียวใช้ได้ทั้งสมอง/เสียงพูด/ฟังเสียง (Boss ขอ 2026-10-20)
  | 'xai';
