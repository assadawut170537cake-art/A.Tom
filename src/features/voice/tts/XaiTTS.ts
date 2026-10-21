/**
 * @file xAI TTS — `POST https://api.x.ai/v1/tts` คืนไฟล์ MP3 ดิบ (Boss ขอ 2026-10-20)
 *
 * - ภาษาไทยไม่อยู่ในรายการทางการ (เอกสาร: ภาษานอกรายการ "พูดได้ ความแม่นยำไม่แน่นอน") → ส่ง `language: auto`
 *   (ใส่ `th` ตรง ๆ เสี่ยง 400 เพราะไม่อยู่ใน allowlist) — ฟังแล้วไม่ดีให้ใช้เจ้าอื่นต่อ persona
 * - speed: 0.7–1.5 (นอกช่วง API ปฏิเสธ → บีบให้อยู่ในช่วง) · ไม่มี pitch
 * - เสียง: `GET /v1/tts/voices` → `{ voices: [{ voice_id, name }] }` · ค่าเริ่มต้น `eve`
 */

import { requestBytes, requestJson } from '../../../core/http/request';
import { isArray, isRecord, isString } from '../../../core/types/guards';
import { BaseCloudTTS, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';
import { XAI_BASE, xaiKey } from '../xaiKey';

export const XAI_TTS_DEFAULT_VOICE = 'eve';
const MIN_SPEED = 0.7;
const MAX_SPEED = 1.5;

export class XaiTTS extends BaseCloudTTS {
  readonly id = 'xai' as const;
  readonly name = 'xAI TTS';

  protected override secret(): Promise<string> {
    return xaiKey('tts');
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.secret()}`, 'Content-Type': 'application/json' };
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const speed =
      opts.speed === undefined ? undefined : Math.min(MAX_SPEED, Math.max(MIN_SPEED, opts.speed));
    const data = await requestBytes(this.id, `${XAI_BASE}/tts`, {
      method: 'POST',
      headers: await this.headers(),
      timeoutMs: 60_000,
      body: JSON.stringify({
        text,
        voice_id: opts.voiceId ?? XAI_TTS_DEFAULT_VOICE,
        language: 'auto',
        ...(speed !== undefined && { speed }),
      }),
    });
    return { data, ext: 'mp3' };
  }

  protected async fetchVoices(): Promise<Voice[]> {
    const body = await requestJson<unknown>(this.id, `${XAI_BASE}/tts/voices`, {
      headers: await this.headers(),
    });
    return parseXaiVoices(body);
  }

  /** รายชื่อเสียงพิสูจน์ key ได้โดยไม่เสียค่าสังเคราะห์ */
  protected override async probe(): Promise<unknown> {
    return requestJson(this.id, `${XAI_BASE}/tts/voices`, { headers: await this.headers() });
  }
}

export function parseXaiVoices(body: unknown): Voice[] {
  if (!isRecord(body) || !isArray(body.voices)) return [];
  return body.voices.flatMap((v): Voice[] => {
    if (!isRecord(v) || !isString(v.voice_id)) return [];
    return [{ id: v.voice_id, name: isString(v.name) ? v.name : v.voice_id }];
  });
}
