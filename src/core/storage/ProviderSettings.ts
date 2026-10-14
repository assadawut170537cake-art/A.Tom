import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AIProviderId } from '../../features/ai/core/types';
import type { STTProviderId, TTSProviderId } from '../../features/voice/core/types';
import type { Persona } from '../../features/jarvis/types';

/**
 * Non-secret provider preferences (AsyncStorage). API keys go in SecureKeyStore instead.
 * Everything lives in one JSON blob, cached in memory after the first read.
 */

const STORAGE_KEY = 'atom.providerSettings.v1';

export interface PersonaVoice {
  providerId: TTSProviderId;
  voiceId?: string;
  speed?: number;
  pitch?: number;
}

interface SettingsData {
  enabled: Partial<Record<AIProviderId, boolean>>;
  priority: AIProviderId[];
  models: Partial<Record<AIProviderId, string>>;
  ttsByPersona: Partial<Record<Persona, PersonaVoice>>;
  stt?: STTProviderId;
  /** Per-provider non-secret options, e.g. options['tts.azure'].region */
  options: Record<string, Record<string, string>>;
}

const EMPTY: SettingsData = { enabled: {}, priority: [], models: {}, ttsByPersona: {}, options: {} };

let cache: SettingsData | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<SettingsData> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<SettingsData>) } : { ...EMPTY };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

/** Serialised read-modify-write so concurrent setters never drop each other's changes. */
function update(mutate: (data: SettingsData) => void): Promise<void> {
  writeChain = writeChain.then(async () => {
    const data = await load();
    mutate(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  });
  return writeChain;
}

export const ProviderSettings = {
  /** undefined = user never toggled it; callers fall back to the provider config default. */
  async getEnabled(providerId: AIProviderId): Promise<boolean | undefined> {
    return (await load()).enabled[providerId];
  },
  setEnabled(providerId: AIProviderId, enabled: boolean): Promise<void> {
    return update((d) => {
      d.enabled[providerId] = enabled;
    });
  },

  async getPriority(): Promise<AIProviderId[]> {
    return [...(await load()).priority];
  },
  setPriority(list: AIProviderId[]): Promise<void> {
    return update((d) => {
      d.priority = [...new Set(list)];
    });
  },

  async getModelFor(providerId: AIProviderId): Promise<string | undefined> {
    return (await load()).models[providerId];
  },
  setModelFor(providerId: AIProviderId, model: string): Promise<void> {
    return update((d) => {
      d.models[providerId] = model;
    });
  },

  async getTTSFor(persona: Persona): Promise<PersonaVoice | undefined> {
    return (await load()).ttsByPersona[persona];
  },
  setTTSFor(persona: Persona, voice: PersonaVoice): Promise<void> {
    return update((d) => {
      d.ttsByPersona[persona] = voice;
    });
  },

  async getSTT(): Promise<STTProviderId | undefined> {
    return (await load()).stt;
  },
  setSTT(providerId: STTProviderId): Promise<void> {
    return update((d) => {
      d.stt = providerId;
    });
  },

  async getOption(scopeId: string, name: string): Promise<string | undefined> {
    return (await load()).options[scopeId]?.[name];
  },
  setOption(scopeId: string, name: string, value: string): Promise<void> {
    return update((d) => {
      d.options[scopeId] = { ...d.options[scopeId], [name]: value };
    });
  },
};

export type ProviderSettingsStore = typeof ProviderSettings;
