import { useCallback, useEffect, useRef, useState } from 'react';

import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import type { LiveVoiceState } from '../../voice/live/LiveVoiceSession';
import { ExpoSystemRecognizer } from '../../voice/live/SystemRecognizer';
import { SystemSpeechSession } from '../../voice/live/SystemSpeechSession';
import { sendMessage } from '../services/conversation';
import { useAtomStore } from '../stores/useAtomStore';
import type { LiveVoiceControls } from './useLiveVoice';

/** ตัวรู้จำเสียงของระบบพร้อมใช้ไหม (Android ต้องมี Google Speech Services) */
export function isSystemSttAvailable(): boolean {
  return new ExpoSystemRecognizer().isAvailable();
}

/**
 * คุยด้วยเสียงผ่านตัวรู้จำเสียงของระบบ (ฟรี ไม่ต้องมี key) — interface เดียวกับ `useLiveVoice`
 * สถานะแปลงเป็น mood ของ Orb เหมือนโหมดอื่น
 */
export function useSystemSpeechVoice(): LiveVoiceControls {
  const [state, setState] = useState<LiveVoiceState>('idle');
  const sessionRef = useRef<SystemSpeechSession | null>(null);

  useEffect(() => {
    const session = new SystemSpeechSession({
      recognizer: new ExpoSystemRecognizer(),
      ensureMic: () => voiceOrchestrator.requestMicrophone(),
      // ข้อความที่ถอดได้ขึ้นเป็นข้อความของบอสในแชทตามปกติ (sendMessage push ให้)
      respond: async (text, hooks) => {
        await sendMessage(text, { onSpeaking: hooks.onSpeaking });
      },
      stopSpeech: () => voiceOrchestrator.stop(),
      onStateChange: (next) => {
        setState(next);
        const store = useAtomStore.getState();
        if (next === 'listening') store.setMood('listening');
        else if (next === 'thinking') store.setMood('thinking');
        else if (next === 'idle' && (store.mood === 'listening' || store.mood === 'thinking'))
          store.setMood('idle');
      },
      onMessage: (message) =>
        useAtomStore.getState().pushMessage({ role: 'system', content: message }),
    });
    sessionRef.current = session;
    return () => {
      session.stop(); // unmount / สลับแท็บ → ปิดไมค์ทันที
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

  // โหมดเฝ้าอยู่ในเส้นทาง classic (useLiveVoice) เท่านั้น
  return { state, active: state !== 'idle', standby: false, start, stop };
}
