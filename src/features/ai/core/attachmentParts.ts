/**
 * @file แปลงไฟล์แนบเป็นรูปแบบที่ provider แต่ละแบบอ่านได้
 *
 * - ไฟล์ข้อความ/โค้ด → ต่อท้ายข้อความเป็น code block (ทุก provider อ่านได้ ไม่ขึ้นกับว่ารองรับไฟล์ไหม)
 * - Gemini → รูป/PDF/เสียง/วิดีโอ ส่งเป็น `inlineData` (base64)
 * - OpenAI-compatible → รูปส่งเป็น `image_url` แบบ data URL · PDF/สื่อ ส่งไม่ได้ → บอกในข้อความแทน (ไม่ทิ้งเงียบ ๆ)
 */

import type { AttachmentData } from '../../../core/types/attachment';
import type { ChatMessage } from './types';

/** ข้อความ + เนื้อไฟล์ข้อความที่แนบ */
export function withTextFiles(content: string, attachments: AttachmentData[] = []): string {
  const files = attachments
    .filter((a) => a.kind === 'text')
    .map((a) => `📎 ไฟล์ ${a.name}:\n\`\`\`\n${a.data}\n\`\`\``);
  return [content, ...files].filter(Boolean).join('\n\n');
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export function geminiParts(m: ChatMessage): GeminiPart[] {
  const files: GeminiPart[] = (m.attachments ?? [])
    .filter((a) => a.kind !== 'text')
    .map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } }));
  return [{ text: withTextFiles(m.content, m.attachments) }, ...files];
}

type OpenAIContent =
  string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export function openAIMessage(m: ChatMessage): {
  role: ChatMessage['role'];
  content: OpenAIContent;
} {
  const attachments = m.attachments ?? [];
  const images = attachments.filter((a) => a.kind === 'image');
  const unsupported = attachments.filter((a) => a.kind === 'pdf' || a.kind === 'media');
  const note = unsupported.length
    ? `\n\n(บอสแนบ ${unsupported.map((a) => a.name).join(', ')} มาด้วย แต่โมเดลนี้อ่านไฟล์ชนิดนี้ไม่ได้ — บอกบอสว่าให้ใช้ Gemini อ่านไฟล์นี้)`
    : '';
  const text = withTextFiles(m.content, attachments) + note;
  if (!images.length) return { role: m.role, content: text };
  return {
    role: m.role,
    content: [
      { type: 'text', text },
      ...images.map((a) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${a.mimeType};base64,${a.data}` },
      })),
    ],
  };
}
