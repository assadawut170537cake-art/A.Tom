import type { ChatArchive } from '../../../core/storage/ChatArchiveStorage';

export interface ChatSearchHit {
  chat: ChatArchive;
  /** ข้อความรอบ ๆ คำที่ค้นเจอ ('' เมื่อไม่ได้ค้น หรือเจอแค่ในชื่อห้อง) */
  snippet: string;
}

const SNIPPET_RADIUS = 30;

/** ค้นห้องแชทจากชื่อห้องและเนื้อหา (ไม่สนตัวพิมพ์เล็กใหญ่) — คำค้นว่าง = ทุกห้อง */
export function searchChats(chats: ChatArchive[], query: string): ChatSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return chats.map((chat) => ({ chat, snippet: '' }));
  const hits: ChatSearchHit[] = [];
  for (const chat of chats) {
    const inTitle = chat.title.toLowerCase().includes(q);
    const message = chat.messages.find((m) => m.role !== 'system' && m.content.toLowerCase().includes(q));
    if (!inTitle && !message) continue;
    let snippet = '';
    if (message) {
      const text = message.content.replace(/\s+/g, ' ');
      const at = text.toLowerCase().indexOf(q);
      const start = Math.max(0, at - SNIPPET_RADIUS);
      const end = Math.min(text.length, at + q.length + SNIPPET_RADIUS);
      snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
    }
    hits.push({ chat, snippet });
  }
  return hits;
}
