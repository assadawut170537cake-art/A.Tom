import AsyncStorage from '@react-native-async-storage/async-storage';

// NOTE(arch, 2026-10-14): core/ imports *types* from features/ (type-only, no runtime cycle).
// Moving Persona/Message/provider-id types into core/ would make the dependency one-way; deferred
// because it touches most feature files — revisit before Phase 4 adds more storage.
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

export interface AdvancedSettings {
  /** Per-request timeout for AI calls. */
  timeoutMs: number;
  /** Extra attempts on the same provider after a retryable failure (429/5xx/timeout/network). */
  retries: number;
  /** Try the next provider in priority order when one fails. */
  fallback: boolean;
}

export const DEFAULT_ADVANCED: AdvancedSettings = { timeoutMs: 30_000, retries: 0, fallback: true };

export type VoiceKind = 'tts' | 'stt';

interface SettingsData {
  enabled: Partial<Record<AIProviderId, boolean>>;
  priority: AIProviderId[];
  models: Partial<Record<AIProviderId, string>>;
  ttsByPersona: Partial<Record<Persona, PersonaVoice>>;
  /** When true every persona speaks with sharedVoice. */
  sameVoiceForAll: boolean;
  sharedVoice?: PersonaVoice;
  stt?: STTProviderId;
  advanced: AdvancedSettings;
  voiceEnabled: { tts: Partial<Record<TTSProviderId, boolean>>; stt: Partial<Record<STTProviderId, boolean>> };
  voicePriority: { tts: TTSProviderId[]; stt: STTProviderId[] };
  /** Per-provider non-secret options, e.g. options['tts.azure'].region */
  options: Record<string, Record<string, string>>;
}

const empty = (): SettingsData => ({
  enabled: {},
  priority: [],
  models: {},
  ttsByPersona: {},
  sameVoiceForAll: false,
  options: {},
  advanced: { ...DEFAULT_ADVANCED },
  voiceEnabled: { tts: {}, stt: {} },
  voicePriority: { tts: [], stt: [] },
});

let cache: SettingsData | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<SettingsData> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<SettingsData>) : {};
    const base = empty();
    cache = {
      ...base,
      ...saved,
      advanced: { ...base.advanced, ...saved.advanced },
      voiceEnabled: { ...base.voiceEnabled, ...saved.voiceEnabled },
      voicePriority: { ...base.voicePriority, ...saved.voicePriority },
    };
  } catch {
    cache = empty();
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

  async getSameVoiceForAll(): Promise<boolean> {
    return (await load()).sameVoiceForAll;
  },
  setSameVoiceForAll(value: boolean): Promise<void> {
    return update((d) => {
      d.sameVoiceForAll = value;
    });
  },
  async getSharedVoice(): Promise<PersonaVoice | undefined> {
    return (await load()).sharedVoice;
  },
  setSharedVoice(voice: PersonaVoice): Promise<void> {
    return update((d) => {
      d.sharedVoice = voice;
    });
  },
  /** The voice a persona actually speaks with (shared voice wins when enabled). */
  async resolveVoiceFor(persona: Persona): Promise<PersonaVoice | undefined> {
    const d = await load();
    return d.sameVoiceForAll ? d.sharedVoice : d.ttsByPersona[persona];
  },

  async getAdvanced(): Promise<AdvancedSettings> {
    return { ...(await load()).advanced };
  },
  setAdvanced(patch: Partial<AdvancedSettings>): Promise<void> {
    return update((d) => {
      d.advanced = { ...d.advanced, ...patch };
    });
  },

  /** Voice providers are enabled unless the user switched them off. */
  async getVoiceEnabled(kind: VoiceKind, id: TTSProviderId | STTProviderId): Promise<boolean> {
    const map = (await load()).voiceEnabled[kind] as Partial<Record<string, boolean>>;
    return map[id] ?? true;
  },
  setVoiceEnabled(kind: VoiceKind, id: TTSProviderId | STTProviderId, enabled: boolean): Promise<void> {
    return update((d) => {
      (d.voiceEnabled[kind] as Partial<Record<string, boolean>>)[id] = enabled;
    });
  },
  async getVoicePriority<K extends VoiceKind>(
    kind: K
  ): Promise<K extends 'tts' ? TTSProviderId[] : STTProviderId[]> {
    return [...(await load()).voicePriority[kind]] as K extends 'tts'
      ? TTSProviderId[]
      : STTProviderId[];
  },
  setVoicePriority(kind: VoiceKind, list: (TTSProviderId | STTProviderId)[]): Promise<void> {
    return update((d) => {
      (d.voicePriority[kind] as string[]) = [...new Set(list)];
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
