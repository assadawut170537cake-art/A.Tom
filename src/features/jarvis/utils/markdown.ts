/**
 * @file แปลง Markdown ที่ LLM ตอบมาเป็นโครงสร้างให้ ChatBubble วาด (ไม่เพิ่ม dependency)
 *
 * รองรับเฉพาะที่ LLM ใช้บ่อย: หัวข้อ, ตัวหนา/เอียง, `code`, บล็อกโค้ด, รายการ (- / 1.),
 * blockquote, ลิงก์ และตาราง (แสดงเป็นตัวอักษรความกว้างคงที่ — จอมือถือแคบเกินจะวาดเป็นตาราง)
 * ที่ไม่รู้จักก็แสดงเป็นข้อความธรรมดา (ไม่ทิ้งเนื้อหา)
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string };

export type BlockNode =
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: { marker: string; inline: InlineNode[] }[] }
  | { type: 'quote'; inline: InlineNode[] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'table'; text: string }
  | { type: 'rule' };

const BULLET = /^\s*[-*•+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** แยก inline: ลำดับความสำคัญ code > link > bold > italic (code ข้างในไม่ถูกแปลงต่อ) */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // ไม่ใช้ lookbehind / \p{…} — ให้ทำงานได้บน Hermes ทุกรุ่น · *เอียง* ต้องไม่มีช่องว่างหลัง * (กัน "2 * 3 * 4")
  const pattern = /(`[^`\n]+`)|(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__)|(\*([^*\s][^*\n]*?)\*)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const index = m.index;
    if (index > last) nodes.push({ type: 'text', text: text.slice(last, index) });
    if (m[1]) nodes.push({ type: 'code', text: m[1].slice(1, -1) });
    else if (m[2]) nodes.push({ type: 'link', text: m[3] ?? '', url: m[4] ?? '' });
    else if (m[5]) nodes.push({ type: 'bold', children: parseInline(m[6] ?? m[7] ?? '') });
    else if (m[8]) nodes.push({ type: 'italic', children: parseInline(m[9] ?? '') });
    last = index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      // โค้ดที่ไม่ปิด ``` (คำตอบถูกตัด/ยังไหลไม่จบ) ก็ยังแสดงเป็นบล็อกโค้ด
      for (i++; i < lines.length && !FENCE.test(lines[i] ?? ''); i++) body.push(lines[i] ?? '');
      blocks.push({ type: 'code', text: body.join('\n'), lang: fence[1] ?? '' });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min((heading[1] ?? '#').length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inline: parseInline(heading[2] ?? '') });
      continue;
    }

    if (TABLE.test(line)) {
      flushParagraph();
      const rows: string[] = [];
      for (; i < lines.length && TABLE.test(lines[i] ?? ''); i++) {
        const row = lines[i] ?? '';
        if (!TABLE_SEPARATOR.test(row)) rows.push(formatTableRow(row));
      }
      i--;
      blocks.push({ type: 'table', text: rows.join('\n') });
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      flushParagraph();
      const quote: string[] = [];
      for (; i < lines.length && (lines[i] ?? '').trimStart().startsWith('>'); i++) {
        quote.push((lines[i] ?? '').trimStart().replace(/^>\s?/, ''));
      }
      i--;
      blocks.push({ type: 'quote', inline: parseInline(quote.join('\n')) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !bullet;
      const items: { marker: string; inline: InlineNode[] }[] = [];
      for (; i < lines.length; i++) {
        const current = lines[i] ?? '';
        const b = BULLET.exec(current);
        const o = ORDERED.exec(current);
        if (isOrdered ? o : b) {
          items.push({ marker: isOrdered ? `${o?.[1] ?? ''}.` : '•', inline: parseInline((isOrdered ? o?.[2] : b?.[1]) ?? '') });
        } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
          // บรรทัดย่อหน้าใต้รายการ = ข้อความต่อของรายการก่อนหน้า
          const prev = items[items.length - 1];
          if (prev) prev.inline = [...prev.inline, { type: 'text', text: '\n' }, ...parseInline(current.trim())];
        } else {
          break;
        }
      }
      i--;
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function formatTableRow(row: string): string {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .join('  │  ');
}

/** ตัดเครื่องหมาย Markdown ออกให้ TTS อ่าน (ไม่ให้อ่าน "ดอกจัน" หรือ "ชาร์ป") */
export function stripMarkdown(source: string): string {
  return source
    .replace(/```[\w+-]*\n?([\s\S]*?)(```|$)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\s][^*\n]*?)\*/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*•+]\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
