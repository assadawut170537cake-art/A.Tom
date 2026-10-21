/**
 * @file ผู้ให้บริการ AI ที่บอสเพิ่มเองจากในแอป (OpenAI-compatible) — คอนเซ็ปต์ "ต่อได้ทุก API" (ADR-020)
 *
 * เก็บแค่ค่าไม่ลับใน AsyncStorage `atom.ai.v1.customProviders` · key อยู่ SecureStore `ai.<id>` (การ์ดเดียวกับเจ้าอื่น)
 * id = `custom-<slug>` เสมอ (ไม่ชนกับเจ้าในตัว) · ลงทะเบียนเข้า `aiRegistry` ตอน boot และทันทีที่เพิ่ม
 * ใช้ได้ทุกที่ที่เจ้าในตัวใช้ได้: Priority · Fallback · สมองต่อ persona · เลือกโมเดล (โหลดจาก /models)
 */

import { readJSON, writeJSON } from '../../core/storage/jsonStorage';
import { SecureKeyStore, secretKey } from '../../core/storage/SecureKeyStore';
import { isArrayOf, isRecord, isString } from '../../core/types/guards';
import { aiRegistry, type ProviderRegistry } from './core/ProviderRegistry';
import type { AIProviderConfig } from './core/types';
import { OpenAICompatibleAdapter } from './adapters/OpenAICompatibleAdapter';

export const CUSTOM_PROVIDERS_KEY = 'atom.ai.v1.customProviders';

export interface CustomProviderDef {
  id: `custom-${string}`;
  name: string;
  baseURL: string;
  defaultModel: string;
}

const isDef = (v: unknown): v is CustomProviderDef =>
  isRecord(v) &&
  isString(v.id) &&
  v.id.startsWith('custom-') &&
  isString(v.name) &&
  isString(v.baseURL) &&
  isString(v.defaultModel);

/** guard ของ blob ที่เก็บจริง — ใช้ร่วมกับ SettingsHealth เพื่อตรวจ element-level corruption ให้ตรงกับที่โมดูลยอมรับ */
export const isCustomProviderList = (v: unknown): v is CustomProviderDef[] => isArrayOf(v, isDef);

/** http ได้เฉพาะในบ้าน/เครื่องตัวเอง (key วิ่งผ่าน header) — ที่อยู่สาธารณะต้อง https */
const PRIVATE_HTTP =
  /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|[^/]+\.local)/i;

/** ตรวจค่าจากฟอร์ม → def ที่บันทึกได้ หรือข้อความไทยบอกว่าผิดตรงไหน */
export function validateCustomProvider(
  input: { name: string; baseURL: string; defaultModel: string },
  existing: readonly CustomProviderDef[],
): CustomProviderDef | { error: string } {
  const name = input.name.trim();
  const baseURL = input.baseURL.trim().replace(/\/+$/, '');
  const defaultModel = input.defaultModel.trim();
  if (!name) return { error: 'ใส่ชื่อผู้ให้บริการก่อน' };
  if (!/^https?:\/\/[^\s/]+/i.test(baseURL)) {
    return { error: 'Base URL ต้องขึ้นต้นด้วย https:// เช่น https://api.example.com/v1' };
  }
  if (/^http:/i.test(baseURL) && !PRIVATE_HTTP.test(baseURL)) {
    return { error: 'ที่อยู่นอกเครือข่ายบ้านต้องใช้ https:// เพื่อไม่ให้ key รั่ว' };
  }
  if (!defaultModel) return { error: 'ใส่ชื่อโมเดลก่อน (ดูได้จากเอกสารของผู้ให้บริการ)' };
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'ai';
  let id: CustomProviderDef['id'] = `custom-${slug}`;
  for (let n = 2; existing.some((d) => d.id === id); n++) id = `custom-${slug}-${n}`;
  return { id, name, baseURL, defaultModel };
}

export function toConfig(def: CustomProviderDef): AIProviderConfig {
  return {
    id: def.id,
    name: def.name,
    type: 'openai-compatible',
    baseURL: def.baseURL,
    defaultModel: def.defaultModel,
    models: 'dynamic',
    enabled: true,
    purpose: 'llm',
  };
}

export async function loadCustomProviders(): Promise<CustomProviderDef[]> {
  return (await readJSON(CUSTOM_PROVIDERS_KEY, isCustomProviderList)) ?? [];
}

/** ลงทะเบียนทุกตัวที่บันทึกไว้ (boot) · ไม่ reject — อ่านไม่ได้แค่ log */
export async function registerCustomProviders(
  registry: ProviderRegistry = aiRegistry,
): Promise<number> {
  try {
    const defs = await loadCustomProviders();
    for (const def of defs) registry.register(new OpenAICompatibleAdapter(toConfig(def)));
    return defs.length;
  } catch (e) {
    console.error('[ai] โหลดผู้ให้บริการที่เพิ่มเองไม่ได้ — เจ้าในตัวยังใช้ได้ปกติ', e);
    return 0;
  }
}

export async function addCustomProvider(
  def: CustomProviderDef,
  registry: ProviderRegistry = aiRegistry,
): Promise<void> {
  const defs = (await loadCustomProviders()).filter((d) => d.id !== def.id);
  await writeJSON(CUSTOM_PROVIDERS_KEY, [...defs, def]);
  registry.register(new OpenAICompatibleAdapter(toConfig(def)));
}

/** ลบออกจากรายการ + ลบ key + ถอดจาก registry ทันที */
export async function removeCustomProvider(
  id: CustomProviderDef['id'],
  registry: ProviderRegistry = aiRegistry,
): Promise<void> {
  const defs = await loadCustomProviders();
  await writeJSON(
    CUSTOM_PROVIDERS_KEY,
    defs.filter((d) => d.id !== id),
  );
  await SecureKeyStore.delete(secretKey('ai', id));
  registry.unregister(id);
}
