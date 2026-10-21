/**
 * @file ตัวต่อ native ของ SystemSpeechSession: expo-speech-recognition (Google SpeechRecognizer / Apple Speech)
 * โหลดแบบ lazy — ไม่มี native module (Expo Go / jest) = isAvailable() เป็น false แล้วตกไปโหมดอื่น
 */

import { ProviderError } from '../../../core/http/errors';
import type { SystemRecognizer } from './SystemSpeechSession';

type Module = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

export const SYSTEM_STT_LANG = 'th-TH';
/** เงียบต่อเนื่องเท่านี้ = จบประโยค (Android) */
export const SILENCE_END_MS = 1200;

function loadModule(): Module | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    const mod = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
    return mod.ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
}

export class ExpoSystemRecognizer implements SystemRecognizer {
  private cancel: (() => void) | null = null;

  isAvailable(): boolean {
    try {
      return loadModule()?.isRecognitionAvailable() ?? false;
    } catch {
      return false;
    }
  }

  listenOnce(): Promise<string> {
    const mod = loadModule();
    if (!mod) {
      return Promise.reject(
        new ProviderError(
          'system-stt',
          'unsupported',
          'ไม่มี expo-speech-recognition ใน build นี้',
        ),
      );
    }
    return new Promise<string>((resolve, reject) => {
      let last = '';
      let done = false;
      const subs: { remove(): void }[] = [];
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        for (const s of subs) s.remove();
        this.cancel = null;
        fn();
      };
      this.cancel = () => finish(() => resolve(''));

      subs.push(
        mod.addListener('result', (e) => {
          const best = e.results[0]?.transcript;
          if (best) last = best;
          if (e.isFinal) finish(() => resolve(last));
        }),
        mod.addListener('end', () => finish(() => resolve(last))),
        mod.addListener('error', (e) => {
          // ไม่มีเสียงพูด / ฟังไม่ออก = รอบว่าง ไม่ใช่ error
          if (e.error === 'no-speech' || e.error === 'speech-timeout' || e.error === 'aborted') {
            finish(() => resolve(last));
            return;
          }
          finish(() => reject(toProviderError(e.error, e.message)));
        }),
      );

      try {
        mod.start({
          lang: SYSTEM_STT_LANG,
          interimResults: true,
          continuous: false,
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_END_MS,
          },
        });
      } catch (e) {
        finish(() =>
          reject(
            new ProviderError('system-stt', 'server', e instanceof Error ? e.message : String(e)),
          ),
        );
      }
    });
  }

  abort(): void {
    this.cancel?.();
    try {
      loadModule()?.abort();
    } catch {
      // ยกเลิกไม่ได้ก็ปล่อย
    }
  }
}

function toProviderError(code: string, message: string): ProviderError {
  switch (code) {
    case 'not-allowed':
      return new ProviderError(
        'system-stt',
        'permission',
        'ยังไม่ได้อนุญาตไมโครโฟน/การรู้จำเสียง — เปิดสิทธิ์ในตั้งค่าเครื่อง',
      );
    case 'language-not-supported':
    case 'service-not-allowed':
      return new ProviderError('system-stt', 'unsupported', message);
    case 'network':
      return new ProviderError('system-stt', 'network', message || 'ต่อบริการรู้จำเสียงไม่ได้');
    default:
      return new ProviderError('system-stt', 'server', message || code);
  }
}
