/**
 * @file ดูด้วยกล้อง: ถ่ายรูปแล้วให้ Gemini อ่าน/อธิบาย ("ดูป้ายนี้ให้หน่อย", "นี่คืออะไร", "อ่านเมนูให้ฟัง")
 *
 * ถ่ายครั้งละ 1 ภาพตามที่สั่ง (เปิดกล้องของระบบ ไม่ต้องมีหน้าจอพรีวิวของเราเอง) — ถูกกว่าสตรีมวิดีโอตลอดเวลามาก
 * เสียงสดจะเรียกผ่าน ask_atom ได้เหมือนคำสั่งอื่น · รูปไม่ถูกเก็บ (ใช้ส่งครั้งเดียวแล้วทิ้ง)
 */

import type { AgentDefinition } from '../../../core/agents/types';
import { ProviderError } from '../../../core/http/errors';
import { AssistantError, loadNative } from '../shared/errors';
import { assistantModel, geminiGenerate, textOf } from '../shared/gemini';

export const VISION_AGENT_ID = 'vision';

export interface Photo {
  base64: string;
  mimeType: string;
}

export interface VisionDeps {
  /** null = ผู้ใช้ยกเลิก */
  capture?: () => Promise<Photo | null>;
  describe?: (photo: Photo, question: string) => Promise<string>;
}

const DEFAULT_QUESTION =
  'บรรยายสิ่งที่เห็นในภาพสั้น ๆ ถ้ามีตัวหนังสือ (โดยเฉพาะภาษาไทย) ให้อ่านออกมา';

const captureWithCamera = async (): Promise<Photo | null> => {
  const Picker = loadNative(
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    () => require('expo-image-picker') as typeof import('expo-image-picker'),
    'กล้อง',
  );
  const permission = await Picker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new AssistantError(
      'ยังไม่ได้อนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องในตั้งค่าเครื่องก่อนครับ',
    );
  const result = await Picker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.4,
    base64: true,
    exif: false,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset?.base64) return null;
  return { base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' };
};

const describeWithGemini = async (photo: Photo, question: string): Promise<string> => {
  const response = await geminiGenerate(await assistantModel('text'), {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: photo.mimeType, data: photo.base64 } },
          { text: question },
        ],
      },
    ],
    systemInstruction: {
      parts: [
        { text: 'ตอบเป็นภาษาไทย สั้น กระชับ ไม่เกิน 4 ประโยค เหมาะอ่านออกเสียง ไม่ใช้ markdown' },
      ],
    },
  }).catch((e: unknown) => {
    if (e instanceof ProviderError && e.kind === 'bad_request') {
      throw new AssistantError('ส่งรูปให้ Gemini ไม่สำเร็จ — ลองถ่ายใหม่ครับ');
    }
    throw e;
  });
  const text = textOf(response);
  if (!text) throw new AssistantError('Gemini ไม่ได้ตอบกลับมาครับ — ลองถ่ายใหม่ให้ชัดขึ้น');
  return text;
};

export function createVisionAgent(deps: VisionDeps = {}): AgentDefinition {
  const capture = deps.capture ?? captureWithCamera;
  const describe = deps.describe ?? describeWithGemini;
  return {
    id: VISION_AGENT_ID,
    name: 'กล้อง',
    description: 'ถ่ายรูปแล้วให้ AI อ่าน/อธิบายสิ่งที่เห็น',
    capabilities: [
      {
        id: 'vision.look',
        label: 'ดูด้วยกล้อง',
        patterns: [
          /^(?:ช่วย)?(?:ดู|อ่าน|ถ่าย|สแกน)(?:นี่|นี้|รูป|ภาพ|ป้าย|ฉลาก|เมนู|เอกสาร|ของ|สิ่งนี้)(?:ให้|ให้หน่อย)?\s*(?<command>.*)$/,
          /^(?<command>(?:นี่|อันนี้|สิ่งนี้)(?:คือ)?(?:อะไร|ตัวอะไร))$/,
        ],
        examples: ['ดูป้ายนี้ให้หน่อย', 'อ่านเมนูให้ฟัง', 'นี่คืออะไร'],
      },
    ],
    async run({ commandText }) {
      const photo = await capture();
      if (!photo) return { reply: 'ยกเลิกการถ่ายภาพแล้วครับ' };
      const question = commandText.trim() || DEFAULT_QUESTION;
      return {
        reply: await describe(
          photo,
          question === DEFAULT_QUESTION ? question : `${question}\n(${DEFAULT_QUESTION})`,
        ),
      };
    },
  };
}
