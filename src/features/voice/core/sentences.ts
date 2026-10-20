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
  const chunks: string[] = [];
  let buffer = '';
  for (const piece of pieces) {
    buffer = buffer ? `${buffer} ${piece}` : piece;
    if (buffer.length >= minChars) {
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
