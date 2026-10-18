/**
 * @file แปลงคำตอบ "list models" ของแต่ละผู้ให้บริการเป็นรายชื่อ model id
 *
 * ข้อมูลมาจาก network (trust boundary) → ตรวจด้วย type guard ทุกชั้น ไม่ cast
 * รายการที่รูปแบบผิดถูกข้ามทีละตัว (เก็บตัวดี ตัดตัวเสีย) — คำตอบที่ไม่ใช่ object เลยถึงจะ throw
 * ผลลัพธ์: ไม่ซ้ำ + เรียงตามตัวอักษร เพื่อให้ picker แสดงลำดับคงที่
 */

import { ProviderError } from '../../../core/http/errors';
import { isArray, isRecord, isString } from '../../../core/types/guards';

/** ไม่ซ้ำ + ตัดช่องว่าง + ตัดค่าว่าง + เรียง */
export function normalizeModelIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function bodyOf(providerId: string, data: unknown): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new ProviderError(providerId, 'invalid_response', 'รายชื่อโมเดลอยู่ในรูปแบบที่อ่านไม่ได้');
  }
  return data;
}

/** รายการใน field `key` (ไม่มี / ไม่ใช่ array = ว่าง) */
function itemsOf(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const list = body[key];
  return isArray(list) ? list.filter(isRecord) : [];
}

/** OpenAI-compatible `GET {baseURL}/models` → `{ data: [{ id }] }` (OpenRouter ใช้รูปแบบนี้) */
export function parseOpenAIModels(providerId: string, data: unknown): string[] {
  const ids = itemsOf(bodyOf(providerId, data), 'data')
    .map((m) => m.id)
    .filter(isString);
  return normalizeModelIds(ids);
}

export interface GeminiModelPage {
  ids: string[];
  nextPageToken: string | undefined;
}

/**
 * Gemini `GET /v1beta/models` → `{ models: [{ name: "models/…", supportedGenerationMethods }], nextPageToken }`
 * เก็บเฉพาะตัวที่รองรับ `generateContent` (ตัด embedding / AQA ฯลฯ ที่ใช้คุยไม่ได้) และตัด prefix `models/`
 */
export function parseGeminiModels(providerId: string, data: unknown): GeminiModelPage {
  const body = bodyOf(providerId, data);
  const ids = itemsOf(body, 'models')
    .filter((m) => {
      const methods = m.supportedGenerationMethods;
      return isArray(methods) && methods.includes('generateContent');
    })
    .map((m) => m.name)
    .filter(isString)
    .map((name) => name.replace(/^models\//, ''));
  const token = body.nextPageToken;
  return { ids: normalizeModelIds(ids), nextPageToken: isString(token) && token ? token : undefined };
}

/** Jev (TypeSafe) `GET /v1/models` → `{ models: [{ name }] }` */
export function parseJevModels(providerId: string, data: unknown): string[] {
  const ids = itemsOf(bodyOf(providerId, data), 'models')
    .map((m) => m.name)
    .filter(isString);
  return normalizeModelIds(ids);
}
