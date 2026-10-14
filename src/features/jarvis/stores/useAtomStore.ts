import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ProviderSettings, type PersonaVoice } from '../../../core/storage/ProviderSettings';
import { getPersonaPrompt } from '../../ai/prompts/personaPrompts';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { DEFAULT_PERSONA } from '../constants';
import type { Message, MessageRole, OrbMood, Persona, UIMode } from '../types';

export interface PushMessageInput {
  role: MessageRole;
  content: string;
  /** Defaults to the active persona */
  persona?: Persona;
}

interface AtomState {
  uiMode: UIMode;
  mood: OrbMood;
  activePersona: Persona;
  /** System prompt of the active persona (sent with every chat request). */
  systemPrompt: string;
  /** TTS voice of the active persona; undefined = default voice (Expo Speech). */
  voice: PersonaVoice | undefined;
  /** In-memory only for Phase 2 (not persisted) */
  messagesByPersona: Record<Persona, Message[]>;
  dropdownOpen: boolean;

  setUIMode: (mode: UIMode) => void;
  setMood: (mood: OrbMood) => void;
  setActivePersona: (persona: Persona) => void;
  /** Re-read the active persona's voice (e.g. after editing the Persona Voice Map). */
  refreshVoice: () => Promise<void>;
  pushMessage: (input: PushMessageInput) => Message;
  toggleDropdown: () => void;
  closeDropdown: () => void;
}

const emptyHistory = (): Record<Persona, Message[]> => ({ 1: [], 2: [], 3: [], 4: [] });

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
      pushMessage: ({ role, content, persona }) => {
        const target = persona ?? get().activePersona;
        const message: Message = {
          id: createId(),
          persona: target,
          role,
          content,
          createdAt: Date.now(),
        };
        set((s) => ({
          messagesByPersona: {
            ...s.messagesByPersona,
            [target]: [...s.messagesByPersona[target], message],
          },
        }));
        return message;
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
