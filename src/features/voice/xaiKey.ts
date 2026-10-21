/**
 * @file คีย์ xAI ร่วมกันระหว่างสมอง (Grok) / เสียงพูด / ฟังเสียง — บอสใส่ที่เดียวก็ใช้ได้ทั้งสามทาง
 * ลำดับ: key ของการ์ดนั้นเอง (`tts.xai` / `stt.xai`) → key ของ Grok (`ai.xai`)
 */

import { ProviderError } from '../../core/http/errors';
import { SecureKeyStore, secretKey } from '../../core/storage/SecureKeyStore';

export const XAI_BASE = 'https://api.x.ai/v1';

export async function xaiKey(scope: 'tts' | 'stt'): Promise<string> {
  const key =
    (await SecureKeyStore.get(secretKey(scope, 'xai'))) ??
    (await SecureKeyStore.get(secretKey('ai', 'xai')));
  if (!key) {
    throw new ProviderError(
      'xai',
      'missing_key',
      'ยังไม่ได้ตั้งค่า API key — ใช้ key เดียวกับ xAI Grok ได้ที่ ตั้งค่า › AI Providers',
    );
  }
  return key;
}
