/**
 * @file ถอดเสียงด้วยระบบของเครื่อง (Android = บริการ Google ในเครื่อง) ผ่าน expo-speech-recognition
 *
 * ไม่ต้องมี API key และไม่เสียเงิน · ตัว recognizer ฟังไมค์เองและตัดจบประโยคเอง จึงใช้แทน
 * "อัดไฟล์ + VAD + ส่ง STT" ทั้งชุดในโหมดไลฟ์ (ดู LiveVoiceSession `native`)
 *
 * ทำไมไม่ถอดจากไฟล์: Android ถอดจากไฟล์ได้เฉพาะ WAV PCM 16kHz (Android 13+) แต่ expo-audio อัดได้แค่ AAC
 */

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { ProviderError } from '../../../core/http/errors';
import { STT_LANGUAGE } from '../core/STTInterface';

/** เงียบเท่านี้หลังพูด = จบประโยค (ค่าเริ่มต้นของ Android สั้นไป คนไทยเว้นวรรคคิดบ่อย) */
const END_SILENCE_MS = 1200;

export interface NativeListenHandle {
  /** ข้อความที่ถอดได้ ('' = ไม่ได้ยินอะไร) · reject = recognizer ใช้ไม่ได้ (ProviderError) */
  result: Promise<string>;
  /** เลิกฟังทันที (result ได้ '') */
  cancel(): void;
}

export function isNativeSTTAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** ขอสิทธิ์ไมค์ + การรู้จำเสียง (Android ขอแค่ไมค์) */
export async function ensureNativeSTTPermission(): Promise<void> {
  const res = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!res.granted) {
    throw new ProviderError(
      'expo',
      'permission',
      'ยังไม่ได้อนุญาตให้ใช้ไมโครโฟน — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › สิทธิ์'
    );
  }
}

/** error ที่แปลว่า "ไม่ได้ยินอะไร" — ไม่ใช่ความผิดพลาด ให้ฟังใหม่ */
const SILENT_ERRORS = new Set(['no-speech', 'speech-timeout', 'aborted']);

/** ฟังหนึ่งประโยค */
export function nativeListenOnce(lang: string = STT_LANGUAGE): NativeListenHandle {
  let transcript = '';
  let settled = false;
  let resolve: (text: string) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const result = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const subs = [
    ExpoSpeechRecognitionModule.addListener('result', (e) => {
      const best = e.results[0]?.transcript;
      if (best) transcript = best;
    }),
    ExpoSpeechRecognitionModule.addListener('error', (e) => {
      if (SILENT_ERRORS.has(e.error)) return finish(() => resolve(''));
      const kind = e.error === 'not-allowed' ? 'permission' : e.error === 'network' ? 'network' : 'unsupported';
      finish(() => reject(new ProviderError('expo', kind, `ถอดเสียงในเครื่องไม่สำเร็จ (${e.error}) ${e.message}`.trim())));
    }),
    ExpoSpeechRecognitionModule.addListener('end', () => finish(() => resolve(transcript.trim()))),
  ];

  function finish(settle: () => void) {
    if (settled) return;
    settled = true;
    for (const sub of subs) sub.remove();
    settle();
  }

  try {
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      addsPunctuation: true,
      androidIntentOptions: {
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: END_SILENCE_MS,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: END_SILENCE_MS,
      },
    });
  } catch (e) {
    finish(() => reject(new ProviderError('expo', 'unsupported', `เปิดการถอดเสียงในเครื่องไม่ได้: ${String(e)}`)));
  }

  return {
    result,
    cancel() {
      if (settled) return;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // หยุดไปแล้ว
      }
      finish(() => resolve(''));
    },
  };
}
