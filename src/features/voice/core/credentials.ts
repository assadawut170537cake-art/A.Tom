import { ProviderError } from '../../../core/http/errors';
import { request } from '../../../core/http/request';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';

/** Shared by the TTS and STT base classes: credentials live under the provider's scope. */
type VoiceScope = 'tts' | 'stt';

/** Secret from SecureKeyStore (field omitted = the main API key); missing → missing_key. */
export async function providerSecret(
  scope: VoiceScope,
  id: string,
  field?: string
): Promise<string> {
  const value = await SecureKeyStore.get(secretKey(scope, id, field));
  if (!value) throw new ProviderError(id, 'missing_key', `ยังไม่ได้ตั้งค่า ${field ?? 'API key'}`);
  return value;
}

/** Non-secret option from ProviderSettings (`${scope}.${id}`); missing and no fallback → missing_key. */
export async function providerOption(
  scope: VoiceScope,
  id: string,
  name: string,
  fallback?: string
): Promise<string> {
  const value = (await ProviderSettings.getOption(`${scope}.${id}`, name)) ?? fallback;
  if (!value) throw new ProviderError(id, 'missing_key', `ยังไม่ได้ตั้งค่า ${name}`);
  return value;
}

/** Azure Speech TTS and STT share one key check: the token endpoint validates key + region. */
export function azureIssueToken(
  providerId: string,
  region: string,
  key: string
): Promise<Response> {
  return request(
    providerId,
    `https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key } }
  );
}
