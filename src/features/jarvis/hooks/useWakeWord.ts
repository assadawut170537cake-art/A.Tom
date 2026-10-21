import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { resolveWake } from '../../voice/wakeword/wakeConfig';
import { wakeSettings } from '../../voice/wakeword/wakeSettings';
import { WakeWordService } from '../../voice/wakeword/WakeWordService';
import { useAtomStore } from '../stores/useAtomStore';

/**
 * ฟังคำปลุกตลอดเวลาที่แอปเปิดอยู่และ "ไม่ได้คุย" (`idle`) — ได้ยินแล้วปล่อยไมค์ให้เสร็จก่อน แล้วเรียก `onWake`
 * เริ่มใหม่อัตโนมัติเมื่อจบการคุย / เปลี่ยนการตั้งค่า / กลับเข้าแอป · แอปอยู่เบื้องหลัง = หยุดฟัง (Android ไม่ให้ใช้ไมค์เงียบ ๆ)
 */
/** แจ้งเตือนเรื่องคำปลุกไปแล้วในรอบเปิดแอปนี้ */
let warnedThisLaunch = false;

export function useWakeWord(idle: boolean, onWake: () => void): void {
  const onWakeRef = useRef(onWake);
  // อัปเดตใน effect (ไม่แตะ ref ตอน render) — callback ล่าสุดเสมอโดยไม่ต้องเริ่มฟังใหม่
  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    if (!idle) return;
    let cancelled = false;
    let service: WakeWordService | null = null;

    const stop = async () => {
      const current = service;
      service = null;
      await current?.stop();
    };

    const sync = async () => {
      await stop();
      if (cancelled || AppState.currentState !== 'active') return;
      if (wakeSettings.isMicBusy() || !(await wakeSettings.isEnabled())) return;
      let failure: unknown = null;
      const resolved = await resolveWake().catch((e: unknown) => {
        failure = e;
        return null;
      });
      if (cancelled) return;
      if (!resolved) {
        // บอกครั้งเดียวต่อการเปิดแอป — เดิมขึ้นซ้ำทุกครั้งที่กลับมาหน้าหลัก (Boss เจอ 2026-10-21)
        if (!warnedThisLaunch) {
          warnedThisLaunch = true;
          useAtomStore.getState().pushMessage({
            role: 'system',
            content:
              failure instanceof Error
                ? `⚠️ คำปลุกใช้ไม่ได้ตอนนี้ — ${failure.message}`
                : '⚠️ ยังไม่ได้ลงทะเบียนคำปลุก “เฮ่ อะตอม” — ไปที่ ตั้งค่า › ผู้ช่วยส่วนตัว หรือเลือก Hey Jarvis',
          });
        }
        return;
      }
      const next = new WakeWordService({
        models: resolved.models,
        options: resolved.options,
        onError: (e) => console.error('[wakeword]', e),
      });
      service = next;
      try {
        await next.start(() => {
          // ปล่อยไมค์ให้เสร็จก่อนเริ่มคุย (ใช้ไมค์พร้อมกันไม่ได้)
          void next.stop().then(() => {
            if (!cancelled) onWakeRef.current();
          });
        });
      } catch (e) {
        console.error('[wakeword] เริ่มฟังคำปลุกไม่สำเร็จ', e);
        service = null;
      }
    };

    void sync();
    const unsubscribe = wakeSettings.subscribe(() => void sync());
    const appState = AppState.addEventListener('change', () => void sync());
    return () => {
      cancelled = true;
      unsubscribe();
      appState.remove();
      void stop();
    };
  }, [idle]);
}
