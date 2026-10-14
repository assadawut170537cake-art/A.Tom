import { ProviderSettings, type ProviderSettingsStore } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey, type KeyStore } from '../../../core/storage/SecureKeyStore';
import { aiRegistry, type ProviderRegistry } from './ProviderRegistry';

/**
 * true เมื่อมี LLM provider ที่เปิดอยู่อย่างน้อยหนึ่งตัวที่ใส่ API key แล้ว — คือแชทมีโอกาสได้คำตอบ
 * (provider สำหรับ router เช่น Jev ไม่นับ เพราะตอบแชทไม่ได้)
 */
export async function hasConfiguredLLM(
  registry: ProviderRegistry = aiRegistry,
  settings: ProviderSettingsStore = ProviderSettings,
  keys: KeyStore = SecureKeyStore
): Promise<boolean> {
  for (const provider of registry.list()) {
    const { id, purpose, enabled } = provider.config;
    if ((purpose ?? 'llm') !== 'llm') continue;
    if (!((await settings.getEnabled(id)) ?? enabled)) continue;
    if (await keys.has(secretKey('ai', id))) return true;
  }
  return false;
}
