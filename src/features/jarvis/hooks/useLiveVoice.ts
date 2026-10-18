import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { getBargeIn } from '../../voice/live/liveSettings';
import {
  LiveVoiceSession,
  type LiveNativeListener,
  type LiveRecorder,
  type LiveVoiceState,
} from '../../voice/live/LiveVoiceSession';
import { ensureNativeSTTPermission, isNativeSTTAvailable, nativeListenOnce } from '../../voice/stt/nativeRecognizer';
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

/** ห่อ expo-audio AudioRecorder ให้เป็น LiveRecorder */
function createRecorderAdapter(recorder: AudioRecorder): LiveRecorder {
  return {
    async start() {
      // iOS: ต้องเปิด allowsRecording ก่อน prepare ไม่งั้นอัดไม่ได้
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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

/** recognizer ของเครื่อง — ใช้เมื่อ STT ตัวแรกคือ "ในเครื่อง" (ค่าเริ่มต้น) หรือเป็นทางสำรองตอนไม่มี key */
const nativeListener: LiveNativeListener = {
  async preferred() {
    if (!isNativeSTTAvailable() || !(await voiceOrchestrator.prefersNativeSTT())) return false;
    await ensureNativeSTTPermission();
    return true;
  },
  available: isNativeSTTAvailable,
  listen: () => nativeListenOnce(),
};

export interface LiveVoiceControls {
  state: LiveVoiceState;
  active: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * โหมดคุยด้วยเสียงแบบไลฟ์บนหน้าหลัก: ต่อ LiveVoiceSession เข้ากับ expo-audio + STT + sendMessage
 * และแปลงสถานะเป็น mood ของ Orb (ฟัง = listening · ถอดเสียง = thinking · คิด/พูด = sendMessage เดินเอง)
 */
export function useLiveVoice(): LiveVoiceControls {
  const recorder = useAudioRecorder(LIVE_RECORDING_OPTIONS);
  const [state, setState] = useState<LiveVoiceState>('idle');
  const sessionRef = useRef<LiveVoiceSession | null>(null);

  // สร้าง session ต่อ recorder (recorder เปลี่ยนเมื่อ options เปลี่ยนเท่านั้น) · unmount / สลับแท็บ → ปิดไมค์ทันที
  useEffect(() => {
    const session = new LiveVoiceSession({
      recorder: createRecorderAdapter(recorder),
      ensureMic: () => voiceOrchestrator.requestMicrophone(),
      transcribe: (uri) => voiceOrchestrator.listen(uri),
      respond: async (text, hooks) => {
        // ข้อความที่ถอดได้ขึ้นเป็นข้อความของบอสในแชทตามปกติ (sendMessage push ให้)
        await sendMessage(text, { onSpeaking: hooks.onSpeaking });
      },
      stopSpeech: () => voiceOrchestrator.stop(),
      native: nativeListener,
      bargeIn: getBargeIn,
      onStateChange: (next) => {
        setState(next);
        const store = useAtomStore.getState();
        if (next === 'listening') store.setMood('listening');
        else if (next === 'transcribing') store.setMood('thinking');
        // ออกจากโหมด: คืน mood ที่โหมดไลฟ์ตั้งเอง (ถ้า sendMessage ยังทำงานอยู่ มันจะคืน idle เองอีกรอบ)
        else if (next === 'idle' && (store.mood === 'listening' || store.mood === 'thinking')) {
          store.setMood('idle');
        }
      },
      onMessage: (message) => useAtomStore.getState().pushMessage({ role: 'system', content: message }),
    });
    sessionRef.current = session;
    return () => {
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

  return { state, active: state !== 'idle', start, stop };
}
