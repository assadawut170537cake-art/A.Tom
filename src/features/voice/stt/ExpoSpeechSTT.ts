import { ProviderError } from '../../../core/http/errors';
import type { STTProvider } from '../core/types';
import { isNativeSTTAvailable } from './nativeRecognizer';

const FILE_UNSUPPORTED =
  'ระบบถอดเสียงของเครื่องฟังจากไมค์โดยตรง ถอดจากไฟล์เสียงไม่ได้ — ใช้ได้ในโหมดคุยด้วยเสียง (กดค้างที่ Orb)';
const UNAVAILABLE =
  'เครื่องนี้ไม่มีบริการถอดเสียง — ติดตั้ง/อัปเดตแอป Google แล้วลองใหม่ หรือเลือก STT บนคลาวด์ใน ตั้งค่า › เสียง';

/**
 * ถอดเสียงในเครื่อง (ไม่ต้องมี key) — ตัวงานจริงอยู่ใน nativeRecognizer + LiveVoiceSession `native`
 * เพราะ recognizer ของ Android ฟังจากไมค์เอง · `transcribe(file)` จึง unsupported → VoiceOrchestrator
 * ข้ามไปใช้ STT บนคลาวด์ตัวถัดไปเมื่อมีคนส่งไฟล์มา
 */
export class ExpoSpeechSTT implements STTProvider {
  readonly id = 'expo' as const;
  readonly name = 'ถอดเสียงในเครื่อง';

  async transcribe(_audioUri: string): Promise<string> {
    throw new ProviderError(this.id, 'unsupported', FILE_UNSUPPORTED);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return isNativeSTTAvailable() ? { ok: true } : { ok: false, error: `[${this.id}] ${UNAVAILABLE}` };
  }
}
