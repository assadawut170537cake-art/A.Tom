/**
 * @file Gemini TTS — สังเคราะห์เสียงผ่าน `models/{model}:generateContent` (responseModalities AUDIO)
 *
 * - key: ใช้ key เดียวกับ Gemini LLM (`ai.gemini`) · ถ้าบอสใส่ key แยกในการ์ด TTS (`tts.gemini`) จะใช้ตัวนั้นก่อน
 * - model: ตั้งได้ใน ตั้งค่า › Voice (option `model`) ค่าเริ่มต้น {@link GEMINI_TTS_DEFAULT_MODEL}
 *   (รุ่น 2.5 TTS เปิดให้เฉพาะบัญชีที่เคยใช้มาก่อน และรองรับภาษาไทยไม่ครบทุกรุ่น — 3.8 Flash TTS รองรับไทย)
 * - เสียงที่ได้: 3.8 ส่ง `audio/wav` · 2.5/3.1 ส่ง PCM ดิบ `audio/L16` → ห่อ WAV header เอง (ดู wav.ts)
 * - speed/pitch: Gemini TTS ไม่มีพารามิเตอร์ตัวเลข (คุมได้ด้วยคำสั่งภาษาธรรมชาติเท่านั้น) → ไม่ส่ง
 */

import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { BaseCloudTTS, TTS_LANGUAGE, type SynthesizedAudio } from '../core/TTSInterface';
import type { SpeakOptions, Voice } from '../core/types';
import { decodeBase64, pcmFormatFromMime, pcmToWav } from '../core/wav';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_TTS_DEFAULT_MODEL = 'gemini-3.8-flash-tts';
/** เสียงตัวอย่างในเอกสารของ Google — ใช้เมื่อยังไม่ได้เลือกเสียง */
export const GEMINI_TTS_DEFAULT_VOICE = 'Kore';

/** 30 prebuilt voices ของ Gemini TTS (ชื่อ — สไตล์ตามเอกสาร Google) */
const VOICE_STYLES: readonly (readonly [name: string, style: string, thai: string])[] = [
  ['Zephyr', 'Bright', 'สดใส'],
  ['Puck', 'Upbeat', 'ร่าเริง'],
  ['Charon', 'Informative', 'ให้ข้อมูล'],
  ['Kore', 'Firm', 'หนักแน่น'],
  ['Fenrir', 'Excitable', 'ตื่นเต้น'],
  ['Leda', 'Youthful', 'วัยรุ่น'],
  ['Orus', 'Firm', 'หนักแน่น'],
  ['Aoede', 'Breezy', 'สบาย ๆ'],
  ['Callirrhoe', 'Easy-going', 'ชิล ๆ'],
  ['Autonoe', 'Bright', 'สดใส'],
  ['Enceladus', 'Breathy', 'เสียงลมหายใจ'],
  ['Iapetus', 'Clear', 'ชัดเจน'],
  ['Umbriel', 'Easy-going', 'ชิล ๆ'],
  ['Algieba', 'Smooth', 'นุ่มนวล'],
  ['Despina', 'Smooth', 'นุ่มนวล'],
  ['Erinome', 'Clear', 'ชัดเจน'],
  ['Algenib', 'Gravelly', 'แหบห้าว'],
  ['Rasalgethi', 'Informative', 'ให้ข้อมูล'],
  ['Laomedeia', 'Upbeat', 'ร่าเริง'],
  ['Achernar', 'Soft', 'นุ่ม'],
  ['Alnilam', 'Firm', 'หนักแน่น'],
  ['Schedar', 'Even', 'เรียบ'],
  ['Gacrux', 'Mature', 'ผู้ใหญ่'],
  ['Pulcherrima', 'Forward', 'ตรงไปตรงมา'],
  ['Achird', 'Friendly', 'เป็นมิตร'],
  ['Zubenelgenubi', 'Casual', 'เป็นกันเอง'],
  ['Vindemiatrix', 'Gentle', 'อ่อนโยน'],
  ['Sadachbia', 'Lively', 'มีชีวิตชีวา'],
  ['Sadaltager', 'Knowledgeable', 'รอบรู้'],
  ['Sulafat', 'Warm', 'อบอุ่น'],
];

export const GEMINI_TTS_VOICES: readonly Voice[] = VOICE_STYLES.map(([name, style, thai]) => ({
  id: name,
  name: `${name} — ${thai} (${style})`,
}));

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

export class GeminiTTS extends BaseCloudTTS {
  readonly id = 'gemini' as const;
  readonly name = 'Gemini TTS';

  /** key ของ TTS เอง (ถ้ามี) → ไม่งั้นใช้ key ของ Gemini LLM */
  protected override async secret(): Promise<string> {
    const key =
      (await SecureKeyStore.get(secretKey('tts', this.id))) ??
      (await SecureKeyStore.get(secretKey('ai', 'gemini')));
    if (!key) {
      throw new ProviderError(
        this.id,
        'missing_key',
        'ยังไม่ได้ตั้งค่า API key — ใช้ key เดียวกับ Gemini ได้ที่ ตั้งค่า › AI Providers'
      );
    }
    return key;
  }

  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.secret(), 'Content-Type': 'application/json' };
  }

  /** ช่อง model ว่าง (เช่น บอสลบทิ้ง) = ใช้ค่าเริ่มต้น ไม่ใช่ error */
  private async model(): Promise<string> {
    return (await ProviderSettings.getOption(`tts.${this.id}`, 'model'))?.trim() || GEMINI_TTS_DEFAULT_MODEL;
  }

  protected async synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio> {
    const model = await this.model();
    const data = await requestJson<GenerateContentResponse>(
      this.id,
      `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: await this.headers(),
        timeoutMs: 60_000,
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: opts.voiceId || GEMINI_TTS_DEFAULT_VOICE },
              },
              languageCode: TTS_LANGUAGE,
            },
          },
        }),
      }
    );

    const candidate = data.candidates?.[0];
    const audio = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!audio?.data) {
      const reason = data.promptFeedback?.blockReason ?? candidate?.finishReason;
      throw new ProviderError(
        this.id,
        'invalid_response',
        reason ? `ไม่มีเสียงในคำตอบ (${reason})` : 'ไม่มีเสียงในคำตอบ'
      );
    }
    return toPlayable(this.id, audio.mimeType ?? '', audio.data);
  }

  /** รายชื่อเสียงคงที่ (Gemini ไม่มี endpoint ให้ list เสียง) */
  protected async fetchVoices(): Promise<Voice[]> {
    return GEMINI_TTS_VOICES.map((v) => ({ ...v }));
  }

  /** GET ข้อมูล model — พิสูจน์ทั้ง key และชื่อ model โดยไม่เสียค่าสังเคราะห์เสียง */
  protected override async probe(): Promise<unknown> {
    const model = await this.model();
    return requestJson(this.id, `${BASE}/models/${encodeURIComponent(model)}`, {
      headers: await this.headers(),
    });
  }
}

/** mime ที่ Gemini ส่งมา → ข้อมูล + นามสกุลไฟล์ที่ expo-audio เล่นได้ */
function toPlayable(providerId: string, mimeType: string, base64: string): SynthesizedAudio {
  const mime = mimeType.toLowerCase();
  if (mime.includes('wav')) return { data: { base64 }, ext: 'wav' };
  if (mime.includes('l16') || mime.includes('pcm')) {
    return { data: pcmToWav(decodeBase64(base64), pcmFormatFromMime(mimeType)), ext: 'wav' };
  }
  if (mime.includes('mpeg') || mime.includes('mp3')) return { data: { base64 }, ext: 'mp3' };
  if (mime.includes('ogg')) return { data: { base64 }, ext: 'ogg' };
  throw new ProviderError(providerId, 'invalid_response', `รูปแบบเสียงไม่รองรับ (${mimeType || 'ไม่ระบุ'})`);
}
