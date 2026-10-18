import { DEFAULT_ADVANCED, ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { registerAIProviders } from '../features/ai';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { registerVoiceProviders } from '../features/voice';
import { STT_PROVIDERS, TTS_PROVIDERS } from '../features/voice/voice.config';

/** Register every AI + voice provider into the app-wide registries (idempotent). */
export function registerAll() {
  registerAIProviders();
  registerVoiceProviders();
}

/**
 * ProviderSettings keeps an in-memory cache for the whole test file, so put every setting a test
 * may depend on back to a known baseline (the same values a fresh install resolves to).
 */
export async function resetSettings() {
  await ProviderSettings.setEnabled('gemini', true);
  await ProviderSettings.setEnabled('openrouter', true);
  await ProviderSettings.setEnabled('jev', false);
  await ProviderSettings.setPriority([]);
  await ProviderSettings.setModelFor('gemini', 'gemini-3-flash');
  await ProviderSettings.setModelFor('openrouter', 'openai/gpt-5.6');
  await ProviderSettings.setModelFor('jev', 'jev-latest');
  await ProviderSettings.setAdvanced({ ...DEFAULT_ADVANCED });
  await ProviderSettings.setSameVoiceForAll(false);
  for (const p of TTS_PROVIDERS) await ProviderSettings.setVoiceEnabled('tts', p.id, true);
  for (const p of STT_PROVIDERS) await ProviderSettings.setVoiceEnabled('stt', p.id, true);
  await ProviderSettings.setVoicePriority('tts', []);
  await ProviderSettings.setVoicePriority('stt', []);
}

/** Store fake keys for the given AI providers (removes keys for the rest). */
export async function setAIKeys(ids: ('gemini' | 'openrouter' | 'jev')[]) {
  for (const id of ['gemini', 'openrouter', 'jev'] as const) {
    if (ids.includes(id)) await SecureKeyStore.set(secretKey('ai', id), `${id}-test-key`);
    else await SecureKeyStore.delete(secretKey('ai', id));
  }
}

/** Empty chat histories and go back to ATOM in idle mode. */
export function resetStore() {
  useAtomStore.setState({
    messagesByPersona: { 1: [], 2: [], 3: [], 4: [] },
    archivesByPersona: { 1: [], 2: [], 3: [], 4: [] },
    composerDraft: null,
    uiMode: 'idle',
    mood: 'idle',
  });
  useAtomStore.getState().setActivePersona(1);
}
