/**
 * @file xAI STT — `POST https://api.x.ai/v1/stt` (multipart) → `{ text }` · รองรับไทย (`th`) ทางการ
 */

import { requestJson } from '../../../core/http/request';
import { BaseCloudSTT, STT_LANGUAGE_SHORT } from '../core/STTInterface';
import { XAI_BASE, xaiKey } from '../xaiKey';

export const XAI_STT_MODEL = 'grok-voice-transcribe-2.0';

export class XaiSTT extends BaseCloudSTT {
  readonly id = 'xai' as const;
  readonly name = 'xAI STT';

  protected override secret(): Promise<string> {
    return xaiKey('stt');
  }

  async transcribe(audioUri: string): Promise<string> {
    const form = new FormData();
    form.append('model', XAI_STT_MODEL);
    form.append('language', STT_LANGUAGE_SHORT);
    // เอกสาร: file ต้องเป็น field สุดท้ายของ multipart
    form.append('file', this.audioFormPart(audioUri));
    const data = await requestJson<{ text?: string }>(this.id, `${XAI_BASE}/stt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.secret()}` },
      body: form,
      timeoutMs: 120_000,
    });
    return this.requireText(data.text);
  }

  /** ไม่มี endpoint ตรวจ key ของ STT โดยเฉพาะ → ใช้รายชื่อเสียงของ TTS (key เดียวกัน ไม่เสียเงิน) */
  protected async probe(): Promise<unknown> {
    return requestJson(this.id, `${XAI_BASE}/tts/voices`, {
      headers: { Authorization: `Bearer ${await this.secret()}` },
    });
  }
}
