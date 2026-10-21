import { requestJson } from '../../../core/http/request';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { isRecord } from '../../../core/types/guards';
import { AssistantError } from './errors';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_TEXT_MODEL = 'gemini-3-flash';
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

/** key Gemini ที่บอสตั้งไว้ (AI Providers → สำรอง Gemini TTS) */
export async function geminiKey(): Promise<string> {
  for (const name of [secretKey('ai', 'gemini'), secretKey('tts', 'gemini')]) {
    const value = await SecureKeyStore.get(name);
    if (value) return value;
  }
  throw new AssistantError('ยังไม่ได้ตั้งค่า Gemini API key — ใส่ที่ ตั้งค่า › AI ก่อนครับ');
}

export async function assistantModel(kind: 'text' | 'image'): Promise<string> {
  const saved = await ProviderSettings.getOption(
    'assistant',
    kind === 'text' ? 'model' : 'imageModel',
  );
  return saved ?? (kind === 'text' ? DEFAULT_TEXT_MODEL : DEFAULT_IMAGE_MODEL);
}

/** เรียก generateContent ของ Gemini (key อยู่ใน header ไม่อยู่ใน URL) */
export async function geminiGenerate(
  model: string,
  body: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  const key = await geminiKey();
  return requestJson<unknown>('assistant', `${BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

interface Part {
  text?: unknown;
  inlineData?: unknown;
}

function partsOf(response: unknown): Part[] {
  if (!isRecord(response) || !Array.isArray(response.candidates)) return [];
  const first: unknown = response.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts))
    return [];
  return first.content.parts.filter(isRecord) as Part[];
}

export function textOf(response: unknown): string {
  return partsOf(response)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export function imageOf(response: unknown): { mimeType: string; data: string } | null {
  for (const p of partsOf(response)) {
    if (isRecord(p.inlineData) && typeof p.inlineData.data === 'string') {
      return {
        data: p.inlineData.data,
        mimeType: typeof p.inlineData.mimeType === 'string' ? p.inlineData.mimeType : 'image/png',
      };
    }
  }
  return null;
}

/** ชื่อแหล่งอ้างอิงจาก grounding (ไม่เอา URL — คำตอบถูกอ่านออกเสียง) */
export function sourcesOf(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.candidates)) return [];
  const first: unknown = response.candidates[0];
  if (!isRecord(first) || !isRecord(first.groundingMetadata)) return [];
  const chunks = first.groundingMetadata.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const titles: string[] = [];
  for (const chunk of chunks) {
    if (isRecord(chunk) && isRecord(chunk.web) && typeof chunk.web.title === 'string') {
      if (!titles.includes(chunk.web.title)) titles.push(chunk.web.title);
    }
  }
  return titles;
}
