import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ChatHistoryStorage } from '../../../core/storage/ChatHistoryStorage';
import { ProviderSettings, type PersonaVoice } from '../../../core/storage/ProviderSettings';
import type { AttachmentRef } from '../../../core/types/attachment';
import { getPersonaPrompt } from '../../ai/prompts/personaPrompts';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { DEFAULT_PERSONA, PERSONA_IDS } from '../constants';
import type { Message, MessageRole, OrbMood, Persona, UIMode } from '../types';

interface PushMessageInput {
  role: MessageRole;
  content: string;
  /** Defaults to the active persona */
  persona?: Persona;
  attachments?: AttachmentRef[] | undefined;
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
  /**
   * คำตอบที่ AI กำลังพิมพ์อยู่ (สตรีม) — แสดงเป็นบับเบิลสดท้ายแชท · **ไม่บันทึก/ไม่ซิงก์**
   * พิมพ์จบแล้ว conversation ล้างค่านี้แล้ว pushMessage คำตอบเต็มตามปกติ
   */
  streaming: { persona: Persona; content: string; startedAt: number } | null;

  setUIMode: (mode: UIMode) => void;
  setMood: (mood: OrbMood) => void;
  setActivePersona: (persona: Persona) => void;
  /** Re-read the active persona's voice (e.g. after editing the Persona Voice Map). */
  refreshVoice: () => Promise<void>;
  pushMessage: (input: PushMessageInput) => Message;
  /** Merge messages pulled from another device (shared chat room) — dedupe by id, keep per persona. */
  mergeRemoteMessages: (messages: Message[]) => void;
  /** Load saved histories (call once at app start); messages already in memory are kept. */
  loadHistory: () => Promise<void>;
  toggleDropdown: () => void;
  closeDropdown: () => void;
  appendStreaming: (persona: Persona, text: string) => void;
  clearStreaming: () => void;
  /** ลบประวัติแชทของ persona หนึ่ง (หน้า ประวัติ › ล้าง · บอสยืนยันก่อน) */
  clearHistory: (persona: Persona) => void;
}

const emptyHistory = (): Record<Persona, Message[]> => ({ 1: [], 2: [], 3: [], 4: [] });

/**
 * ตัวรับข้อความใหม่ของเครื่องนี้ (ห้องแชทเดียวกัน) — chatSync เป็นคนลงทะเบียน · ไม่ลงทะเบียน = ไม่ซิงก์
 * เรียกเฉพาะข้อความที่พิมพ์/ตอบในเครื่องนี้ ไม่เรียกตอน merge ของเครื่องอื่น (กันส่งวน)
 */
let localMessageSink: ((message: Message) => void) | null = null;
export function setLocalMessageSink(sink: ((message: Message) => void) | null): void {
  localMessageSink = sink;
}

/** เรียงตามเวลา (นาฬิกาของเครื่องที่พิมพ์) · เท่ากัน = เรียงตาม id ให้ลำดับคงที่ทุกเครื่อง */
const byCreatedAt = (a: Message, b: Message): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Persist one persona's history; a failed write switches the store to memory-only mode. */
async function saveHistory(persona: Persona) {
  const ok = await ChatHistoryStorage.save(
    persona,
    useAtomStore.getState().messagesByPersona[persona],
  );
  if (!ok && useAtomStore.getState().historyPersisted)
    useAtomStore.setState({ historyPersisted: false });
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
      streaming: null,

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
      pushMessage: ({ role, content, persona, attachments, imageUri }) => {
        const target = persona ?? get().activePersona;
        const message: Message = {
          id: createId(),
          persona: target,
          role,
          content,
          createdAt: Date.now(),
          ...(attachments?.length && { attachments }),
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
        // ห้องแชทเดียวกัน: ส่งเฉพาะบทสนทนาจริง (user/assistant) ขึ้น Mark 55 · system = เฉพาะเครื่อง
        if (localMessageSink && (role === 'user' || role === 'assistant'))
          localMessageSink(message);
        return message;
      },
      mergeRemoteMessages: (incoming) => {
        const changed = new Set<Persona>();
        set((s) => {
          const next = { ...s.messagesByPersona };
          for (const persona of PERSONA_IDS) {
            const have = new Set(next[persona].map((m) => m.id));
            const fresh = incoming.filter((m) => m.persona === persona && !have.has(m.id));
            if (!fresh.length) continue;
            next[persona] = [...next[persona], ...fresh].sort(byCreatedAt);
            changed.add(persona);
          }
          return changed.size ? { messagesByPersona: next } : s;
        });
        if (get().historyLoaded) changed.forEach((p) => void saveHistory(p));
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
      appendStreaming: (persona, text) =>
        set((s) => {
          const same = s.streaming?.persona === persona ? s.streaming : null;
          return {
            streaming: {
              persona,
              content: (same?.content ?? '') + text,
              startedAt: same?.startedAt ?? Date.now(),
            },
          };
        }),
      clearStreaming: () => set({ streaming: null }),
      clearHistory: (persona) => {
        set((s) => ({ messagesByPersona: { ...s.messagesByPersona, [persona]: [] } }));
        if (get().historyLoaded) void saveHistory(persona);
      },
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
    },
  ),
);
