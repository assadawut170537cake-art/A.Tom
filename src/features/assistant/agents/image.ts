/**
 * @file สร้างรูปจากคำสั่ง ("วาดแมวใส่หมวก") ด้วยโมเดลรูปของ Gemini แล้วแสดงในแชท
 * รูปเก็บในโฟลเดอร์เอกสารของแอป (อยู่ถาวร ไม่โดนระบบล้าง cache) · เปลี่ยนโมเดลได้ที่ option `assistant/imageModel`
 */

import { File, Paths } from 'expo-file-system';

import type { AgentDefinition } from '../../../core/agents/types';
import { ProviderError } from '../../../core/http/errors';
import { base64ToBytes } from '../../voice/realtime/pcm';
import { AssistantError } from '../shared/errors';
import { assistantModel, geminiGenerate, imageOf } from '../shared/gemini';

export const IMAGE_AGENT_ID = 'image';

export interface GeneratedImage {
  data: string;
  mimeType: string;
}

export interface ImageDeps {
  generate?: (prompt: string) => Promise<GeneratedImage>;
  save?: (image: GeneratedImage) => Promise<string>;
  now?: () => number;
}

const geminiGenerateImage = async (prompt: string): Promise<GeneratedImage> => {
  const response = await geminiGenerate(
    await assistantModel('image'),
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    },
    120_000,
  ).catch((e: unknown) => {
    if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'bad_request')) {
      throw new AssistantError(
        'Gemini key นี้สร้างรูปไม่ได้ — โมเดลรูปอาจต้องเปิดบิลใน Google AI Studio ครับ',
      );
    }
    throw e;
  });
  const image = imageOf(response);
  if (!image) throw new AssistantError('โมเดลไม่ได้ส่งรูปกลับมา — ลองอธิบายภาพใหม่อีกครั้งครับ');
  return image;
};

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function saveToDocuments(now: () => number) {
  return async (image: GeneratedImage): Promise<string> => {
    const file = new File(
      Paths.document,
      `atom-image-${now()}.${EXTENSIONS[image.mimeType] ?? 'png'}`,
    );
    file.create();
    file.write(base64ToBytes(image.data));
    return file.uri;
  };
}

export function createImageAgent(deps: ImageDeps = {}): AgentDefinition {
  const generate = deps.generate ?? geminiGenerateImage;
  const save = deps.save ?? saveToDocuments(deps.now ?? (() => Date.now()));
  return {
    id: IMAGE_AGENT_ID,
    name: 'สร้างรูป',
    description: 'วาด/สร้างรูปจากคำอธิบายด้วย AI',
    capabilities: [
      {
        id: 'image.generate',
        label: 'สร้างรูป',
        patterns: [
          /^(?:ช่วย)?(?:วาด(?:รูป|ภาพ)?|สร้าง(?:รูป|ภาพ)|เจน(?:รูป|ภาพ)|ทำรูป|generate\s+(?:an?\s+)?image(?:\s+of)?|draw)\s*(?<command>(?!.*(?:ไหม|หรือเปล่า|ยังไง|อย่างไร)$).{3,})$/i,
        ],
        examples: ['วาดรูปแมวใส่หมวกนักบินอวกาศ', 'สร้างภาพโลโก้ร้านกาแฟสไตล์มินิมอล'],
      },
    ],
    async run({ commandText }) {
      const image = await generate(commandText);
      const imageUri = await save(image);
      return { reply: 'วาดให้แล้วครับ', imageUri };
    },
  };
}
