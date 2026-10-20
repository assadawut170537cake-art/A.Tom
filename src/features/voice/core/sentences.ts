/**
 * @file แบ่งคำตอบเป็นประโยคย่อย เพื่อให้ TTS พูดประโยคแรกได้ทันทีโดยไม่ต้องรอสังเคราะห์ทั้งก้อน
 *
 * แบ่งที่ "ตัวจบประโยค" ([.!?…] / ขึ้นบรรทัดใหม่) เท่านั้น — ไม่แบ่งที่ช่องว่าง เพราะภาษาไทยเว้นวรรค
 * ระหว่างคำได้ (จะกลายเป็นเศษคำ) · แล้วรวมเศษสั้น ๆ เข้าด้วยกันจนแต่ละชิ้นยาวพอ (`minChars`)
 * ไม่ให้พูดเป็นคำ ๆ สะดุด · ข้อความที่ไม่มีตัวจบประโยคเลย (ไทยส่วนมาก) = คืนทั้งก้อนชิ้นเดียว
 */

/** ตัวจบประโยค + เครื่องหมายปิดท้าย (เช่น ") ตามด้วยช่องว่าง หรือขึ้นบรรทัดใหม่ — เก็บตัวจบไว้กับประโยค */
const BOUNDARY = /([.!?…。！？]+[)\]"'”’]*\s+|\n+)/;

/** ชิ้นที่สั้นกว่านี้ถือว่าเล็กไป รวมกับชิ้นถัดไป (กันพูดกระท่อนกระแท่น) */
const DEFAULT_MIN_CHARS = 12;

/**
 * แบ่งข้อความเป็นชิ้นสำหรับพูดทีละประโยค — ชิ้นแรกสั้นพอให้เริ่มพูดเร็ว แต่ไม่สั้นจนสะดุด
 * คืน `[ทั้งก้อน]` เมื่อไม่มีตัวจบประโยค · คืน `[]` เมื่อว่าง
 */
export function splitSentences(text: string, minChars = DEFAULT_MIN_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // split ด้วย capture group → [ประโยค, ตัวคั่น, ประโยค, ตัวคั่น, …, ประโยคท้าย]
  const raw = trimmed.split(BOUNDARY);
  const pieces: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const piece = `${raw[i] ?? ''}${raw[i + 1] ?? ''}`.trim();
    if (piece) pieces.push(piece);
  }

  // รวมประโยคที่สั้นเกินเข้าด้วยกันจนถึง minChars (เศษท้ายไปรวมกับชิ้นก่อนหน้า)
  // ชิ้นแรกปล่อยสั้นได้ (threshold = 1) เพื่อให้เริ่มพูดเร็วสุด แม้ขึ้นต้นด้วยคำสั้น ๆ ("ครับ" / "โอเค")
  // ชิ้นถัด ๆ ไปถึงใช้ minChars เต็ม (กันพูดกระท่อนกระแท่น)
  const chunks: string[] = [];
  let buffer = '';
  for (const piece of pieces) {
    buffer = buffer ? `${buffer} ${piece}` : piece;
    const threshold = chunks.length === 0 ? 1 : minChars;
    if (buffer.length >= threshold) {
      chunks.push(buffer);
      buffer = '';
    }
  }
  if (buffer) {
    if (chunks.length > 0) chunks[chunks.length - 1] += ` ${buffer}`;
    else chunks.push(buffer);
  }

  return chunks.length > 0 ? chunks : [trimmed];
}

/** ท่อนแรกต้องยาวอย่างน้อยเท่านี้ (กันพูดเศษคำ เช่น "อ.") */
const FIRST_MIN_CHARS = 6;
/** ไม่มีเครื่องหมายจบประโยค (ไทยส่วนมาก) → ตัดที่ช่องว่างได้เมื่อยาวถึงเท่านี้ (ท่อนแรก / ท่อนถัดไป) */
const FIRST_SPACE_MIN = 18;
const SPACE_MIN = 40;

// ระหว่างสตรีม ต้องมีช่องว่าง/ขึ้นบรรทัด "ตามหลัง" ตัวจบประโยคจริง ๆ — ท้าย buffer อาจเป็นแค่จุดที่เน็ตตัดท่อน
// (เช่น "ราคา 3." + "5 บาท" ต้องไม่ถูกตัดเป็นสองท่อน) · จบสตรีม (final) ได้ทั้งหมดอยู่แล้ว
const BOUNDARY_G = /[.!?…。！？]+[)\]"'”’]*\s+|\n+/g;

/**
 * ระหว่างสตรีม: ตัดข้อความส่วนที่ "พูดได้แล้ว" ออกจากหัว buffer · คืน `[พูดได้, ที่เหลือ]` (พูดได้ = '' ถ้ายังไม่ควรพูด)
 * - ตัดที่ตัวจบประโยค/ขึ้นบรรทัด: ท่อนแรก = จุดตัด **แรก** (เริ่มพูดเร็วสุด) · ท่อนต่อไป = จุดตัด **สุดท้าย** (รวบหลายประโยคเป็นก้อนเดียว = เรียก TTS น้อยครั้ง)
 * - ไม่มีเครื่องหมาย (ไทยมักไม่ใส่จุด) → ใช้ช่องว่างสุดท้ายเป็นจุดตัดเมื่อยาวพอ — ภาษาไทยเว้นวรรคระหว่างวลี/ประโยคอยู่แล้ว
 * - `final` (สตรีมจบแล้ว) = ทุกอย่างที่เหลือ
 */
export function takeSpeakable(
  buffer: string,
  { first, final }: { first: boolean; final: boolean },
): [string, string] {
  if (final) return [buffer.trim(), ''];
  const minLen = first ? FIRST_MIN_CHARS : DEFAULT_MIN_CHARS;

  let cut = -1;
  for (const m of buffer.matchAll(BOUNDARY_G)) {
    const end = (m.index ?? 0) + m[0].length;
    if (buffer.slice(0, end).trim().length < minLen) continue;
    cut = end;
    if (first) break; // ท่อนแรก: เอาจุดตัดแรกที่ยาวพอ
  }

  if (cut === -1) {
    const spaceMin = first ? FIRST_SPACE_MIN : SPACE_MIN;
    if (buffer.trim().length >= spaceMin) {
      const lastSpace = buffer.search(/\s\S*$/); // ช่องว่างตัวสุดท้ายก่อนคำที่ยังพิมพ์ไม่จบ
      if (lastSpace > 0 && buffer.slice(0, lastSpace).trim().length >= minLen) cut = lastSpace;
    }
  }

  if (cut === -1) return ['', buffer];
  return [buffer.slice(0, cut).trim(), buffer.slice(cut).replace(/^\s+/, '')];
}
