import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ChatHistoryStorage } from '../../../core/storage/ChatHistoryStorage';
import { ProviderSettings, type PersonaVoice } from '../../../core/storage/ProviderSettings';
import { getPersonaPrompt } from '../../ai/prompts/personaPrompts';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { DEFAULT_PERSONA, PERSONA_IDS } from '../constants';
import type { Message, MessageRole, OrbMood, Persona, UIMode } from '../types';

interface PushMessageInput {
  role: MessageRole;
  content: string;
  /** Defaults to the active persona */
  persona?: Persona;
  imageUri?: string | undefined;
}

interface AtomState {
  uiMode: UIMode;
  mood: OrbMood;
  activePersona: Persona;
  /** System prompt of the active persona (sent with every chat request). */
  systemPrompt: string;
  /** TTS voice of the active persona; undefined = default voice (Expo Speech). */
  voice: PersonaVoice | undefined;
  /** Separate history per persona, saved per persona after every message (ChatHistoryStorage). */
  messagesByPersona: Record<Persona, Message[]>;
  /** True once saved histories have been loaded (saves wait for this so nothing is overwritten). */
  historyLoaded: boolean;
  /** False after a storage read/write failure: history keeps working, but only in memory. */
  historyPersisted: boolean;
  dropdownOpen: boolean;

  setUIMode: (mode: UIMode) => void;
  setMood: (mood: OrbMood) => void;
  setActivePersona: (persona: Persona) => void;
  /** Re-read the active persona's voice (e.g. after editing the Persona Voice Map). */
  refreshVoice: () => Promise<void>;
  pushMessage: (input: PushMessageInput) => Message;
  /** Load saved histories (call once at app start); messages already in memory are kept. */
  loadHistory: () => Promise<void>;
  toggleDropdown: () => void;
  closeDropdown: () => void;
}

const emptyHistory = (): Record<Persona, Message[]> => ({ 1: [], 2: [], 3: [], 4: [] });

/** Persist one persona's history; a failed write switches the store to memory-only mode. */
async function saveHistory(persona: Persona) {
  const ok = await ChatHistoryStorage.save(persona, useAtomStore.getState().messagesByPersona[persona]);
  if (!ok && useAtomStore.getState().historyPersisted) useAtomStore.setState({ historyPersisted: false });
}

let idCounter = 0;
const createId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const useAtomStore = create<AtomState>()(
  persist(
    (set, get) => ({
      uiMode: 'idle',
      mood: 'idle',
      activePersona: DEFAULT_PERSONA,
      systemPrompt: getPersonaPrompt(DEFAULT_PERSONA),
      voice: undefined,
      messagesByPersona: emptyHistory(),
      historyLoaded: false,
      historyPersisted: true,
      dropdownOpen: false,

      setUIMode: (uiMode) => set({ uiMode }),
      setMood: (mood) => set({ mood }),
      // Switching persona swaps prompt + voice; chat history stays separate per persona
      setActivePersona: (activePersona) => {
        if (activePersona !== get().activePersona) voiceOrchestrator.stop();
        set({ activePersona, systemPrompt: getPersonaPrompt(activePersona) });
        void get().refreshVoice();
      },
      refreshVoice: async () => {
        const persona = get().activePersona;
        const voice = await ProviderSettings.resolveVoiceFor(persona);
        // Ignore stale results if the persona changed while loading
        if (get().activePersona === persona) set({ voice });
      },
      pushMessage: ({ role, content, persona, imageUri }) => {
        const target = persona ?? get().activePersona;
        const message: Message = {
          id: createId(),
          persona: target,
          role,
          content,
          createdAt: Date.now(),
          ...(imageUri ? { imageUri } : {}),
        };
        set((s) => ({
          messagesByPersona: {
            ...s.messagesByPersona,
            [target]: [...s.messagesByPersona[target], message],
          },
        }));
        // Before the initial load, loadHistory() saves the merged result instead
        if (get().historyLoaded) void saveHistory(target);
        return message;
      },
      loadHistory: async () => {
        const { ok, histories } = await ChatHistoryStorage.loadAll();
        const current = get().messagesByPersona;
        const merged = emptyHistory();
        const pending: Persona[] = [];
        for (const p of PERSONA_IDS) {
          // Saved messages first, then anything pushed while loading (deduped by id)
          const saved = new Set(histories[p].map((m) => m.id));
          const added = current[p].filter((m) => !saved.has(m.id));
          merged[p] = [...histories[p], ...added];
          if (added.length) pending.push(p);
        }
        set({ messagesByPersona: merged, historyLoaded: true, historyPersisted: ok });
        if (ok) pending.forEach((p) => void saveHistory(p));
      },
      toggleDropdown: () => set((s) => ({ dropdownOpen: !s.dropdownOpen })),
      closeDropdown: () => set({ dropdownOpen: false }),
    }),
    {
      name: 'atom-store',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ activePersona: s.activePersona, uiMode: s.uiMode }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        useAtomStore.setState({ systemPrompt: getPersonaPrompt(state.activePersona) });
        void state.refreshVoice();
      },
    }
  )
);
