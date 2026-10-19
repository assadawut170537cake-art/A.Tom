import {
  isArrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  keysOf,
  type Guard,
} from '../types/guards';
import type { AIProviderId } from '../types/aiProvider';
import type { Persona } from '../types/persona';
import type { STTProviderId, TTSProviderId } from '../types/voiceProvider';
import { readJSON, writeJSON } from './jsonStorage';

/**
 * Non-secret provider preferences (AsyncStorage). API keys go in SecureKeyStore instead.
 * Everything lives in one JSON blob, cached in memory after the first read.
 */

const STORAGE_KEY = 'atom.providerSettings.v1';

export interface PersonaVoice {
  providerId: TTSProviderId;
  voiceId?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
}

/**
 * เสียงเริ่มต้นต่อ persona เมื่อบอสยังไม่ได้ตั้ง Persona Voice Map — ใช้ Expo Speech (ไม่ต้องมี key)
 * แยกกันด้วย pitch/speed เท่านั้น ไม่ใส่ voiceId เพราะ identifier ของเสียงในเครื่องต่างกันตามอุปกรณ์/OS
 * (ใส่ชื่อที่ไม่มีจริง expo-speech จะเงียบหรือตกไปเสียงเดิม) · อยู่ที่ core เพราะ core import features ไม่ได้
 * ค่าที่บอสตั้งเองชนะเสมอ · re-export ที่ features/voice/voice.config.ts
 */
export const DEFAULT_PERSONA_VOICE_MAP: Readonly<Record<Persona, PersonaVoice>> = {
  1: { providerId: 'expo', pitch: 0.85, speed: 1.0 }, // อะตอม: ทุ้มนักเลง
  2: { providerId: 'expo', pitch: 0.95, speed: 0.92 }, // จาร์วิส: นุ่ม สุขุม ช้ากว่าเล็กน้อย
  3: { providerId: 'expo', pitch: 1.25, speed: 1.08 }, // ไฟรเดย์: แหลมเนี๊ยบ เร็ว
  4: { providerId: 'expo', pitch: 0.7, speed: 0.88 }, // อัลตรอน: ต่ำ หนัก
};

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

/** Provider id type for each voice kind, so `tts` maps only ever hold TTS ids (and vice versa). */
export interface VoiceIdOf {
  tts: TTSProviderId;
  stt: STTProviderId;
}

interface SettingsData {
  enabled: Partial<Record<AIProviderId, boolean>>;
  priority: AIProviderId[];
  models: Partial<Record<AIProviderId, string>>;
  /** LLM ที่ persona นี้ใช้ก่อน (ไม่ตั้ง = อัตโนมัติตาม Priority) — ล้มยัง fallback ตัวอื่นต่อ */
  llmByPersona: Partial<Record<Persona, AIProviderId>>;
  ttsByPersona: Partial<Record<Persona, PersonaVoice>>;
  /** When true every persona speaks with sharedVoice. */
  sameVoiceForAll: boolean;
  sharedVoice?: PersonaVoice;
  stt?: STTProviderId;
  advanced: AdvancedSettings;
  voiceEnabled: { [K in VoiceKind]: Partial<Record<VoiceIdOf[K], boolean>> };
  voicePriority: { [K in VoiceKind]: VoiceIdOf[K][] };
  /** Per-provider non-secret options, e.g. options['tts.azure'].region */
  options: Record<string, Record<string, string>>;
}

const empty = (): SettingsData => ({
  enabled: {},
  priority: [],
  models: {},
  llmByPersona: {},
  ttsByPersona: {},
  sameVoiceForAll: false,
  options: {},
  advanced: { ...DEFAULT_ADVANCED },
  voiceEnabled: { tts: {}, stt: {} },
  voicePriority: { tts: [], stt: [] },
});

// ---- validation of the stored blob (written by this module, but storage can be stale/corrupt) --

/** What can be verified about stored data: same shape, but provider ids are just strings. */
interface StoredSettings {
  enabled: Record<string, boolean>;
  priority: string[];
  models: Record<string, string>;
  llmByPersona: Record<string, string>;
  ttsByPersona: Record<string, StoredVoice>;
  sameVoiceForAll: boolean;
  sharedVoice: StoredVoice;
  stt: string;
  advanced: Partial<AdvancedSettings>;
  voiceEnabled: Partial<Record<VoiceKind, Record<string, boolean>>>;
  voicePriority: Partial<Record<VoiceKind, string[]>>;
  options: Record<string, Record<string, string>>;
}

interface StoredVoice {
  providerId: string;
  voiceId?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
}

const recordOf =
  <T>(guard: Guard<T>) =>
  (v: unknown): v is Record<string, T> =>
    isRecord(v) && Object.values(v).every((x) => guard(x));

const optional =
  <T>(guard: Guard<T>) =>
  (v: unknown): v is T | undefined =>
    v === undefined || guard(v);

const isStoredVoice = (v: unknown): v is StoredVoice =>
  isRecord(v) &&
  isString(v.providerId) &&
  optional(isString)(v.voiceId) &&
  optional(isNumber)(v.speed) &&
  optional(isNumber)(v.pitch);

const FIELD_GUARDS: { [K in keyof StoredSettings]: Guard<StoredSettings[K]> } = {
  enabled: recordOf(isBoolean),
  priority: (v): v is string[] => isArrayOf(v, isString),
  models: recordOf(isString),
  llmByPersona: recordOf(isString),
  ttsByPersona: recordOf(isStoredVoice),
  sameVoiceForAll: isBoolean,
  sharedVoice: isStoredVoice,
  stt: isString,
  advanced: (v): v is Partial<AdvancedSettings> =>
    isRecord(v) &&
    optional(isNumber)(v.timeoutMs) &&
    optional(isNumber)(v.retries) &&
    optional(isBoolean)(v.fallback),
  voiceEnabled: (v): v is StoredSettings['voiceEnabled'] =>
    isRecord(v) && optional(recordOf(isBoolean))(v.tts) && optional(recordOf(isBoolean))(v.stt),
  voicePriority: (v): v is StoredSettings['voicePriority'] =>
    isRecord(v) &&
    optional((x): x is string[] => isArrayOf(x, isString))(v.tts) &&
    optional((x): x is string[] => isArrayOf(x, isString))(v.stt),
  options: recordOf(recordOf(isString)),
};

/** Keep every stored field that has the right shape; drop the rest (defaults fill the gaps). */
function validFields(stored: Record<string, unknown>): Partial<SettingsData> {
  const out: Partial<StoredSettings> = {};
  const dropped: string[] = [];
  const keep = <K extends keyof StoredSettings>(key: K) => {
    const value = stored[key];
    if (FIELD_GUARDS[key](value)) out[key] = value;
    else if (value !== undefined) dropped.push(key);
  };
  keysOf(FIELD_GUARDS).forEach(keep);
  if (dropped.length) {
    console.error(
      `[settings] ข้อมูลตั้งค่าเสีย ตัดทิ้งแล้วใช้ค่าเริ่มต้นแทน: ${dropped.join(', ')}`,
    );
  }
  // The single trust boundary: stored provider ids are plain strings that this module wrote from
  // the id unions. They are only ever looked up by known ids, so an unknown id is inert.
  return out as Partial<SettingsData>;
}

let cache: SettingsData | null = null;
let writeChain: Promise<void> = Promise.resolve();
/** False after a storage read/write failed: settings still work, but only in memory. */
let persistent = true;

async function load(): Promise<SettingsData> {
  if (cache) return cache;
  try {
    const stored = await readJSON(STORAGE_KEY, isRecord);
    const saved = stored ? validFields(stored) : {};
    const base = empty();
    cache = {
      ...base,
      ...saved,
      advanced: { ...base.advanced, ...saved.advanced },
      voiceEnabled: { ...base.voiceEnabled, ...saved.voiceEnabled },
      voicePriority: { ...base.voicePriority, ...saved.voicePriority },
    };
  } catch (e) {
    console.error('[settings] อ่านการตั้งค่าไม่ได้ — ใช้ค่าเริ่มต้นในหน่วยความจำแทน', e);
    persistent = false;
    cache = empty();
  }
  return cache;
}

/**
 * Serialised read-modify-write so concurrent setters never drop each other's changes.
 * The in-memory copy is always updated; a failed write only clears `persistent` (never rejects),
 * so one storage error can't break the chain for every later setter or crash the settings UI.
 */
function update(mutate: (data: SettingsData) => void): Promise<void> {
  writeChain = writeChain.then(async () => {
    const data = await load();
    mutate(data);
    try {
      await writeJSON(STORAGE_KEY, data);
      persistent = true;
    } catch (e) {
      console.error('[settings] บันทึกการตั้งค่าไม่ได้ — เก็บไว้ในหน่วยความจำชั่วคราว', e);
      persistent = false;
    }
  });
  return writeChain;
}

export const ProviderSettings = {
  /** False while settings are memory-only (storage failed); they will be lost on restart. */
  isPersistent(): boolean {
    return persistent;
  },

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

  /** undefined = อัตโนมัติ (ตาม Priority + lastGood) */
  async getLLMFor(persona: Persona): Promise<AIProviderId | undefined> {
    return (await load()).llmByPersona[persona];
  },
  /** `undefined` = กลับไปอัตโนมัติ */
  setLLMFor(persona: Persona, providerId: AIProviderId | undefined): Promise<void> {
    return update((d) => {
      if (providerId === undefined) delete d.llmByPersona[persona];
      else d.llmByPersona[persona] = providerId;
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
  /**
   * The voice a persona actually speaks with: shared voice (when enabled) → the user's own setting
   * → DEFAULT_PERSONA_VOICE_MAP. Returns a copy so callers can't mutate the defaults.
   */
  async resolveVoiceFor(persona: Persona): Promise<PersonaVoice | undefined> {
    const d = await load();
    if (d.sameVoiceForAll) return d.sharedVoice;
    return d.ttsByPersona[persona] ?? { ...DEFAULT_PERSONA_VOICE_MAP[persona] };
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
  async getVoiceEnabled<K extends VoiceKind>(kind: K, id: VoiceIdOf[K]): Promise<boolean> {
    const map: Partial<Record<VoiceIdOf[K], boolean>> = (await load()).voiceEnabled[kind];
    return map[id] ?? true;
  },
  setVoiceEnabled<K extends VoiceKind>(kind: K, id: VoiceIdOf[K], enabled: boolean): Promise<void> {
    return update((d) => {
      const map: Partial<Record<VoiceIdOf[K], boolean>> = d.voiceEnabled[kind];
      map[id] = enabled;
    });
  },
  async getVoicePriority<K extends VoiceKind>(kind: K): Promise<VoiceIdOf[K][]> {
    const list: VoiceIdOf[K][] = (await load()).voicePriority[kind];
    return [...list];
  },
  setVoicePriority<K extends VoiceKind>(kind: K, list: VoiceIdOf[K][]): Promise<void> {
    return update((d) => {
      // TS can't assign through a mapped type with a generic key, but it can read the array:
      // replace its contents in place (getVoicePriority hands out copies, so no aliasing)
      const current: VoiceIdOf[K][] = d.voicePriority[kind];
      current.splice(0, current.length, ...new Set(list));
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
