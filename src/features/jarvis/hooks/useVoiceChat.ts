import { useCallback } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { useLiveVoice, type LiveVoiceControls } from './useLiveVoice';
import { shouldUseRealtime, useRealtimeVoice } from './useRealtimeVoice';
import { isSystemSttAvailable, useSystemSpeechVoice } from './useSystemSpeechVoice';
import { useWakeWord } from './useWakeWord';

/** `live.engine`: auto = เสียงสด → ตัวรู้จำเสียงของระบบ → อัดไฟล์ + STT คลาวด์ (เดิม) */
export type LiveEngine = 'auto' | 'realtime' | 'system' | 'classic';
type Picked = 'realtime' | 'system' | 'classic';

export async function pickEngine(): Promise<Picked> {
  const engine = ((await ProviderSettings.getOption('live', 'engine')) ?? 'auto') as LiveEngine;
  if (engine === 'classic' || engine === 'system') return engine;
  if (engine === 'realtime' || (await shouldUseRealtime())) return 'realtime';
  return isSystemSttAvailable() ? 'system' : 'classic';
}

/**
 * ตัวเดียวสำหรับคุยด้วยเสียงบนหน้าหลัก — interface เหมือน `useLiveVoice` ทุกประการ
 * 1) เสียงสด speech-to-speech (Gemini Live / OpenAI Realtime) เมื่อมี key + native module
 * 2) ตัวรู้จำเสียงของระบบ (Google/Apple · ฟรี) 3) อัดไฟล์ → STT คลาวด์ → LLM → TTS (เดิม)
 */
export function useVoiceChat(): LiveVoiceControls {
  const classic = useLiveVoice();
  const realtime = useRealtimeVoice();
  const system = useSystemSpeechVoice();

  const start = useCallback(() => {
    void pickEngine().then((engine) => {
      if (engine === 'realtime') realtime.start();
      else if (engine === 'system') system.start();
      else classic.start();
    });
  }, [classic, realtime, system]);

  const stop = useCallback(() => {
    realtime.stop();
    system.stop();
    classic.stop();
  }, [classic, realtime, system]);

  const active = realtime.active || system.active || classic.active;
  // คำปลุก "เฮ่ อะตอม": ฟังตอนไม่ได้คุย แล้วเปิดโหมดคุยด้วยเสียง
  useWakeWord(!active, start);

  const current = realtime.active ? realtime : system.active ? system : classic;
  return { state: current.state, active, start, stop };
}
