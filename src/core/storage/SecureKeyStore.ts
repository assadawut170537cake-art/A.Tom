import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted storage for API keys and other secrets (Keychain on iOS, Keystore-backed on Android).
 * Never put secrets in AsyncStorage — use ProviderSettings only for non-secret preferences.
 */

const PREFIX = 'atom.secret.';
/** SecureStore only accepts alphanumerics, '.', '-' and '_' in keys. */
const VALID_KEY = /^[A-Za-z0-9._-]+$/;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function storageKey(key: string): string {
  if (!VALID_KEY.test(key)) throw new Error(`Invalid secure key name: "${key}"`);
  return PREFIX + key;
}

/** Conventional key names, e.g. secretKey('ai', 'gemini') → 'ai.gemini'. */
export function secretKey(scope: 'ai' | 'tts' | 'stt', providerId: string, field?: string): string {
  return [scope, providerId, field].filter(Boolean).join('.');
}

export const SecureKeyStore = {
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(storageKey(key), value, OPTIONS);
  },

  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(storageKey(key), OPTIONS);
  },

  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(storageKey(key), OPTIONS);
  },

  async has(key: string): Promise<boolean> {
    const value = await SecureStore.getItemAsync(storageKey(key), OPTIONS);
    return value != null && value !== '';
  },
};

export type KeyStore = typeof SecureKeyStore;
