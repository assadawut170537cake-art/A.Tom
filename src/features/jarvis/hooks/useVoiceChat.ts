import { useCallback } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { useLiveVoice, type LiveVoiceControls } from './useLiveVoice';
import { shouldUseRealtime, useRealtimeVoice } from './useRealtimeVoice';
import { isSystemSttAvailable, useSystemSpeechVoice } from './useSystemSpeechVoice';
import { useWakeWord } from './useWakeWord';

/** `live.engine`: auto = เสียงสด → ตัวรู้จำเสียงของระบบ → อัดไฟล์ + STT คลาวด์ (เดิม) */
export type LiveEngine = 'auto' | 'realtime' | 'system' | 'classic';
type Picked = 'realtime' | 'system' | 'classic';

/** เสียงสดต่อไม่ติดแล้วในรอบเปิดแอปนี้ — auto ข้ามไปทางสำรองเลย ไม่ต้องรอ error ซ้ำทุกครั้ง (รีเซ็ตเมื่อเปิดแอปใหม่) */
let realtimeBroken = false;
export const resetRealtimeBroken = () => {
  realtimeBroken = false;
};

/** ทางสำรองเมื่อไม่ใช้เสียงสด */
const fallbackEngine = (): Picked => (isSystemSttAvailable() ? 'system' : 'classic');

export async function pickEngine(): Promise<Picked> {
  const engine = ((await ProviderSettings.getOption('live', 'engine')) ?? 'auto') as LiveEngine;
  if (engine === 'classic' || engine === 'system') return engine;
  if (engine === 'realtime') return 'realtime';
  if (!realtimeBroken && (await shouldUseRealtime())) return 'realtime';
  return fallbackEngine();
}

/**
 * ตัวเดียวสำหรับคุยด้วยเสียงบนหน้าหลัก — interface เหมือน `useLiveVoice` ทุกประการ
 * 1) เสียงสด speech-to-speech (Gemini Live / OpenAI Realtime) เมื่อมี key + native module
 * 2) ตัวรู้จำเสียงของระบบ (Google/Apple · ฟรี) 3) อัดไฟล์ → STT คลาวด์ → LLM → TTS (เดิม)
 */
export function useVoiceChat(): LiveVoiceControls {
  const classic = useLiveVoice();
  const system = useSystemSpeechVoice();
  // เสียงสดต่อไม่ติด (key/รุ่น/native/เน็ต) → สลับไปทางสำรองทันที บอสพูดต่อได้เลย (Boss เจอไมค์ใช้ไม่ได้ 2026-10-21)
  const realtime = useRealtimeVoice(() => {
    realtimeBroken = true;
    if (fallbackEngine() === 'system') system.start();
    else classic.start();
    return true;
  });

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
  // โหมดเฝ้า (ฟังตลอด) อยู่ในเส้นทาง classic เท่านั้น — เปิดอยู่ = classic.active จึงไม่ชนตัวฟังคำปลุก
  return { state: current.state, active, standby: classic.standby, start, stop };
}
