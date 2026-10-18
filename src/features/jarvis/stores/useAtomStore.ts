import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ChatArchiveStorage, chatTitle, type ChatArchive } from '../../../core/storage/ChatArchiveStorage';
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
  /** ห้องแชทเก่าต่อ persona (ใหม่สุดก่อน) — ห้องที่คุยอยู่คือ messagesByPersona */
  archivesByPersona: Record<Persona, ChatArchive[]>;
  /** ข้อความที่จะใส่ในช่องพิมพ์ (กด "แก้ไข" ข้อความเก่า) — ChatInput รับแล้วเคลียร์ */
  composerDraft: string | null;

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
  /** แก้เนื้อหาข้อความ (คำตอบที่กำลังไหลเข้ามา) — `save: false` = ยังไม่บันทึก (บันทึกตอนจบ) */
  updateMessage: (persona: Persona, id: string, content: string, opts?: { save?: boolean }) => void;
  removeMessage: (persona: Persona, id: string) => void;
  /** ลบข้อความ `id` และทุกข้อความหลังจากนั้น (ตอบใหม่ / แก้ข้อความ) */
  truncateFrom: (persona: Persona, id: string) => void;
  /** เก็บห้องปัจจุบันเข้าห้องเก่า แล้วเริ่มห้องว่าง (ห้องว่างอยู่แล้ว = ไม่ทำอะไร) */
  newChat: (persona?: Persona) => void;
  /** สลับไปห้องเก่า — ห้องปัจจุบัน (ถ้ามีข้อความ) ถูกเก็บเข้าห้องเก่าแทน */
  openChat: (persona: Persona, archiveId: string) => void;
  deleteChat: (persona: Persona, archiveId: string) => void;
  setComposerDraft: (draft: string | null) => void;
}

const emptyArchives = (): Record<Persona, ChatArchive[]> => ({ 1: [], 2: [], 3: [], 4: [] });
const emptyHistory = (): Record<Persona, Message[]> => ({ 1: [], 2: [], 3: [], 4: [] });

/** Persist one persona's history; a failed write switches the store to memory-only mode. */
async function saveHistory(persona: Persona) {
  const ok = await ChatHistoryStorage.save(persona, useAtomStore.getState().messagesByPersona[persona]);
  if (!ok && useAtomStore.getState().historyPersisted) useAtomStore.setState({ historyPersisted: false });
}

async function saveArchives(persona: Persona) {
  await ChatArchiveStorage.save(persona, useAtomStore.getState().archivesByPersona[persona]);
}

/** ห้องปัจจุบันเป็นห้องเก่า (ไม่มีข้อความของบอส/ผู้ช่วย = ไม่เก็บ) */
function archiveOf(messages: Message[]): ChatArchive | null {
  if (!messages.some((m) => m.role !== 'system')) return null;
  return {
    id: createId(),
    title: chatTitle(messages),
    createdAt: messages[0]?.createdAt ?? Date.now(),
    updatedAt: messages.at(-1)?.createdAt ?? Date.now(),
    messages,
  };
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
      archivesByPersona: emptyArchives(),
      composerDraft: null,

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
        // Before the initial load, loadHistory() saves the merged result instead
        if (get().historyLoaded) void saveHistory(target);
        return message;
      },
      loadHistory: async () => {
        const [{ ok, histories }, archives] = await Promise.all([
          ChatHistoryStorage.loadAll(),
          ChatArchiveStorage.loadAll(),
        ]);
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
        set({ messagesByPersona: merged, archivesByPersona: archives, historyLoaded: true, historyPersisted: ok });
        if (ok) pending.forEach((p) => void saveHistory(p));
      },
      toggleDropdown: () => set((s) => ({ dropdownOpen: !s.dropdownOpen })),
      closeDropdown: () => set({ dropdownOpen: false }),
      updateMessage: (persona, id, content, opts) => {
        set((s) => ({
          messagesByPersona: {
            ...s.messagesByPersona,
            [persona]: s.messagesByPersona[persona].map((m) => (m.id === id ? { ...m, content } : m)),
          },
        }));
        if (opts?.save !== false && get().historyLoaded) void saveHistory(persona);
      },
      removeMessage: (persona, id) => {
        set((s) => ({
          messagesByPersona: {
            ...s.messagesByPersona,
            [persona]: s.messagesByPersona[persona].filter((m) => m.id !== id),
          },
        }));
        if (get().historyLoaded) void saveHistory(persona);
      },
      truncateFrom: (persona, id) => {
        const list = get().messagesByPersona[persona];
        const index = list.findIndex((m) => m.id === id);
        if (index === -1) return;
        set((s) => ({ messagesByPersona: { ...s.messagesByPersona, [persona]: list.slice(0, index) } }));
        if (get().historyLoaded) void saveHistory(persona);
      },
      newChat: (persona) => {
        const target = persona ?? get().activePersona;
        const archived = archiveOf(get().messagesByPersona[target]);
        if (!archived) return;
        voiceOrchestrator.stop();
        set((s) => ({
          messagesByPersona: { ...s.messagesByPersona, [target]: [] },
          archivesByPersona: { ...s.archivesByPersona, [target]: [archived, ...s.archivesByPersona[target]] },
        }));
        if (get().historyLoaded) {
          void saveHistory(target);
          void saveArchives(target);
        }
      },
      openChat: (persona, archiveId) => {
        const { archivesByPersona, messagesByPersona } = get();
        const chosen = archivesByPersona[persona].find((c) => c.id === archiveId);
        if (!chosen) return;
        voiceOrchestrator.stop();
        const current = archiveOf(messagesByPersona[persona]);
        const rest = archivesByPersona[persona].filter((c) => c.id !== archiveId);
        set((s) => ({
          messagesByPersona: { ...s.messagesByPersona, [persona]: chosen.messages },
          archivesByPersona: { ...s.archivesByPersona, [persona]: current ? [current, ...rest] : rest },
        }));
        if (get().historyLoaded) {
          void saveHistory(persona);
          void saveArchives(persona);
        }
      },
      deleteChat: (persona, archiveId) => {
        set((s) => ({
          archivesByPersona: {
            ...s.archivesByPersona,
            [persona]: s.archivesByPersona[persona].filter((c) => c.id !== archiveId),
          },
        }));
        if (get().historyLoaded) void saveArchives(persona);
      },
      setComposerDraft: (composerDraft) => set({ composerDraft }),
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
