import { useCallback, useEffect, useRef, useState } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import type { LiveVoiceState } from '../../voice/live/LiveVoiceSession';
import { buildRealtimeConfig } from '../../voice/realtime/config';
import { RoutedTransport, pickRealtimeProvider } from '../../voice/realtime/registry';
import { RealtimeVoiceSession } from '../../voice/realtime/RealtimeVoiceSession';
import { sendMessage } from '../services/conversation';
import { useAtomStore } from '../stores/useAtomStore';
import type { LiveVoiceControls } from './useLiveVoice';

/** เลือกเครื่องยนต์คุยสด: auto = เสียงสด (Gemini Live → OpenAI Realtime) ถ้ามี key + native module ไม่งั้นโหมดอัดไฟล์เดิม */
export type LiveEngine = 'auto' | 'realtime' | 'classic';

export async function shouldUseRealtime(): Promise<boolean> {
  const engine = ((await ProviderSettings.getOption('live', 'engine')) ?? 'auto') as LiveEngine;
  if (engine === 'classic') return false;
  if (engine === 'realtime') return true; // บังคับ — ถ้าขาด key / native จะขึ้น error ที่บอกทางแก้
  return (await pickRealtimeProvider('auto')) !== null;
}

/**
 * โหมดคุยด้วยเสียงสด (speech-to-speech) บนหน้าหลัก — คืน interface เดียวกับ `useLiveVoice`
 * เพื่อให้ MainScreen สลับเครื่องยนต์ได้ · สถานะแปลงเป็น mood ของ Orb
 */
export function useRealtimeVoice(): LiveVoiceControls {
  const [state, setState] = useState<LiveVoiceState>('idle');
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);

  useEffect(() => {
    const session = new RealtimeVoiceSession({
      transport: new RoutedTransport(),
      buildConfig: async () => buildRealtimeConfig(useAtomStore.getState().activePersona),
      ensureMic: () => voiceOrchestrator.requestMicrophone(),
      // delegate เข้า router เดิม (memory / agent / pc-bridge) — ไม่พูดเอง โมเดลเสียงอ่านผลให้
      ask: async (request) => (await sendMessage(request, { speak: false })).reply,
      onUserText: (content) => {
        const { activePersona: persona, pushMessage } = useAtomStore.getState();
        pushMessage({ role: 'user', content, persona });
      },
      onAssistantText: (content) => {
        const { activePersona: persona, pushMessage } = useAtomStore.getState();
        pushMessage({ role: 'assistant', content, persona });
      },
      onStateChange: (next) => {
        setState(next);
        const store = useAtomStore.getState();
        if (next === 'listening') store.setMood('listening');
        else if (next === 'thinking') store.setMood('thinking');
        else if (next === 'speaking') store.setMood('speaking');
        else if (next === 'idle') store.setMood('idle');
      },
      onMessage: (message) =>
        useAtomStore.getState().pushMessage({ role: 'system', content: message }),
    });
    sessionRef.current = session;
    return () => {
      session.stop(); // unmount / สลับแท็บ → วางสายทันที
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const store = useAtomStore.getState();
    store.closeDropdown();
    store.setUIMode('conversation');
    void session.start();
  }, []);

  const stop = useCallback(() => sessionRef.current?.stop(), []);

  return { state, active: state !== 'idle', start, stop };
}
