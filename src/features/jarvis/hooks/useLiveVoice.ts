import {
  RecordingPresets,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import {
  LiveVoiceSession,
  type LiveRecorder,
  type LiveVoiceState,
} from '../../voice/live/LiveVoiceSession';
import { useStandbyStore } from '../../voice/live/standbyStore';
import { sendMessage } from '../services/conversation';
import { useAtomStore } from '../stores/useAtomStore';

/**
 * AAC .m4a (ตรงกับที่ BaseCloudSTT คาด) แบบ mono 64kbps — เสียงพูดไม่ต้อง stereo และไฟล์เล็กอัปโหลดเร็ว
 * metering ต้องเปิด ไม่งั้น VAD ไม่มีระดับเสียงให้อ่าน
 */
export const LIVE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
};

/**
 * ฟังเบื้องหลังได้ไหม — Android ใช้ Foreground Service ซึ่งต้องมีสิทธิ์แจ้งเตือน (POST_NOTIFICATIONS, Android 13+)
 * ⚠️ ไม่มีสิทธิ์แล้วยังเปิด background → expo-audio โยน NotificationPermissionsException ตอน prepare
 * = ไมค์ไม่ทำงานเลย (Boss เจอบนเครื่องจริง 2026-10-20) → ถามสิทธิ์ก่อน ไม่ได้ = อัดแบบหน้าแอปอย่างเดียว
 */
async function canRecordInBackground(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return (await requestNotificationPermissionsAsync()).granted;
  } catch (e) {
    console.error('[voice] ขอสิทธิ์แจ้งเตือนไม่สำเร็จ — ฟังเฉพาะตอนอยู่ในแอป', e);
    return false;
  }
}

/** ห่อ expo-audio AudioRecorder ให้เป็น LiveRecorder */
export function createRecorderAdapter(recorder: AudioRecorder): LiveRecorder {
  return {
    async start() {
      // iOS: ต้องเปิด allowsRecording ก่อน prepare ไม่งั้นอัดไม่ได้
      // allowsBackgroundRecording: ฟังต่อตอนบอสสลับไปแอปอื่น (Android = Foreground Service + แจ้งเตือนค้าง
      // จาก expo-audio `enableBackgroundRecording` ใน app.json) → สั่ง "กดปุ่ม …" กับแอปนั้นได้ (ADR-015 ระดับ B)
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: await canRecordInBackground(),
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
    },
    level() {
      return recorder.getStatus().metering;
    },
    async stop() {
      await recorder.stop();
      // ปิดโหมดอัดทันทีหลังหยุด: iOS ตอน playAndRecord เสียง TTS จะเบา/ออกผิดลำโพง
      await setAudioModeAsync({ allowsRecording: false });
      return recorder.uri;
    },
    async release() {
      await setAudioModeAsync({ allowsRecording: false });
    },
    discard(uri) {
      try {
        new File(uri).delete();
      } catch {
        // ไฟล์ใน cache — ลบไม่ได้ก็ไม่เป็นไร ระบบล้างเอง
      }
    },
  };
}

export const STANDBY_OFF_MESSAGE = 'ปิดโหมดเฝ้าแล้ว — ไมค์หยุดฟัง';

export interface LiveVoiceControls {
  state: LiveVoiceState;
  active: boolean;
  /** โหมดเฝ้าเปิดอยู่ (ฟังตลอด + ต้องเรียกชื่อตอนอยู่แอปอื่น) */
  standby: boolean;
  start: () => void;
  stop: () => void;
}

/** โหมดเฝ้า + แอปไม่ได้อยู่หน้าสุด = ต้องเรียกชื่อก่อนสั่ง */
export function needsWakeWord(standby: boolean, appState: string): boolean {
  return standby && appState !== 'active';
}

/**
 * โหมดคุยด้วยเสียงแบบไลฟ์บนหน้าหลัก: ต่อ LiveVoiceSession เข้ากับ expo-audio + STT + sendMessage
 * และแปลงสถานะเป็น mood ของ Orb (ฟัง = listening · ถอดเสียง = thinking · คิด/พูด = sendMessage เดินเอง)
 *
 * โหมดเฝ้า ({@link useStandbyStore}): เปิด → เริ่มฟังเอง (ตอน mount ด้วยถ้าบันทึกไว้) · ปิด → หยุด
 * บอสแตะหยุด หรือ session ล้ม (เช่น STT ยังไม่ตั้งค่า) ระหว่างเฝ้า → ปิดโหมดเฝ้าตาม (ไม่ค้างว่าเปิดแต่ไม่ได้ฟัง)
 * สลับแท็บ (unmount) ไม่ปิดโหมดเฝ้า — กลับมาหน้าหลักแล้วฟังต่อเอง
 */
export function useLiveVoice(): LiveVoiceControls {
  const recorder = useAudioRecorder(LIVE_RECORDING_OPTIONS);
  const [state, setState] = useState<LiveVoiceState>('idle');
  const standby = useStandbyStore((s) => s.enabled);
  const sessionRef = useRef<LiveVoiceSession | null>(null);

  // สร้าง session ต่อ recorder (recorder เปลี่ยนเมื่อ options เปลี่ยนเท่านั้น) · unmount / สลับแท็บ → ปิดไมค์ทันที
  useEffect(() => {
    /** cleanup กำลังทำงาน — idle จากการ unmount ไม่ปิดโหมดเฝ้า */
    let unmounting = false;
    const session = new LiveVoiceSession({
      recorder: createRecorderAdapter(recorder),
      ensureMic: () => voiceOrchestrator.requestMicrophone(),
      transcribe: (uri) => voiceOrchestrator.listen(uri),
      respond: async (text, hooks) => {
        // ข้อความที่ถอดได้ขึ้นเป็นข้อความของบอสในแชทตามปกติ (sendMessage push ให้)
        await sendMessage(text, { onSpeaking: hooks.onSpeaking });
      },
      stopSpeech: () => voiceOrchestrator.stop(),
      keepAlive: () => useStandbyStore.getState().enabled,
      requireWakeWord: () =>
        needsWakeWord(useStandbyStore.getState().enabled, AppState.currentState),
      onStateChange: (next) => {
        setState(next);
        // จบเองระหว่างเฝ้า (ล้ม / บอสแตะหยุด) → ปิดโหมดเฝ้าตาม · unmount ไม่นับ
        if (next === 'idle' && !unmounting && useStandbyStore.getState().enabled) {
          void useStandbyStore.getState().setEnabled(false);
        }
        const store = useAtomStore.getState();
        if (next === 'listening') store.setMood('listening');
        else if (next === 'transcribing') store.setMood('thinking');
        // ออกจากโหมด: คืน mood ที่โหมดไลฟ์ตั้งเอง (ถ้า sendMessage ยังทำงานอยู่ มันจะคืน idle เองอีกรอบ)
        else if (next === 'idle' && (store.mood === 'listening' || store.mood === 'thinking')) {
          store.setMood('idle');
        }
      },
      onMessage: (message) =>
        useAtomStore.getState().pushMessage({ role: 'system', content: message }),
    });
    sessionRef.current = session;

    const begin = () => {
      if (session.active) return;
      const store = useAtomStore.getState();
      store.closeDropdown();
      store.setUIMode('conversation');
      void session.start();
    };
    // เปิดโหมดเฝ้า (หรือโหลดมาว่าเปิดค้างไว้) → เริ่มฟัง · ปิด → หยุด + บอก
    const unsubscribe = useStandbyStore.subscribe((now, prev) => {
      if (now.enabled && now.loaded && !(prev.enabled && prev.loaded)) begin();
      else if (!now.enabled && prev.enabled) {
        session.stop();
        useAtomStore.getState().pushMessage({ role: 'system', content: STANDBY_OFF_MESSAGE });
      }
    });
    const standbyNow = useStandbyStore.getState();
    if (standbyNow.loaded) {
      if (standbyNow.enabled) begin();
    } else void standbyNow.load();

    return () => {
      unmounting = true;
      unsubscribe();
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [recorder]);

  const start = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const store = useAtomStore.getState();
    store.closeDropdown();
    store.setUIMode('conversation');
    void session.start();
  }, []);

  const stop = useCallback(() => sessionRef.current?.stop(), []);

  return { state, active: state !== 'idle', standby, start, stop };
}
