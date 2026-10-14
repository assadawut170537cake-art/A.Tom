import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  /** In-memory only for Phase 2 (not persisted) */
  messagesByPersona: Record<Persona, Message[]>;
  dropdownOpen: boolean;

  setUIMode: (mode: UIMode) => void;
  setMood: (mood: OrbMood) => void;
  setActivePersona: (persona: Persona) => void;
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
      messagesByPersona: emptyHistory(),
      dropdownOpen: false,

      setUIMode: (uiMode) => set({ uiMode }),
      setMood: (mood) => set({ mood }),
      setActivePersona: (activePersona) => set({ activePersona }),
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
    }
  )
);
