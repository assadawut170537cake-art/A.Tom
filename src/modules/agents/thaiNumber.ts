/**
 * @file แปลงตัวเลขที่เขียนเป็นคำไทย ("สามสิบ", "ยี่สิบห้า", "ร้อย", "ครึ่ง") เป็นตัวเลข
 *
 * มีไว้เพราะ STT บางตัวถอด "ปรับเสียงสามสิบ" เป็นคำ ไม่ใช่ "30" · รองรับแค่ 0–100 พอสำหรับระดับเสียง/ความสว่าง
 * (ไม่ใช่ตัวแปลงตัวเลขไทยทั่วไป — ไม่มีพัน/หมื่น/ทศนิยม)
 */

const DIGITS: Record<string, number> = {
  ศูนย์: 0,
  หนึ่ง: 1,
  เอ็ด: 1,
  สอง: 2,
  ยี่: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
  หก: 6,
  เจ็ด: 7,
  แปด: 8,
  เก้า: 9,
};

/** คำพิเศษที่ STT ชอบถอดออกมาตรง ๆ */
const SPECIAL: Record<string, number> = {
  ครึ่ง: 50,
  ครึ่งหนึ่ง: 50,
  เต็ม: 100,
  สุด: 100,
  สูงสุด: 100,
  ต่ำสุด: 0,
};

/** ใช้ใน regex ของ agent — ลำดับยาวก่อนสั้น ("ครึ่งหนึ่ง" ก่อน "ครึ่ง", "สูงสุด" ก่อน "สุด") */
export const THAI_NUMBER_PATTERN = String.raw`(?:ครึ่งหนึ่ง|ครึ่ง|สูงสุด|ต่ำสุด|เต็ม|สุด|(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย)+)`;

const TOKEN = /ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย/gy;

/** คืนตัวเลข หรือ null ถ้าไม่ใช่ตัวเลขคำไทยที่รู้จัก · ตัวเลขอารบิกส่งกลับตามเดิม */
export function parseThaiNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const special = SPECIAL[text];
  if (special !== undefined) return special;

  let total = 0;
  let current: number | null = null;
  let consumed = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    consumed += m[0].length;
    const word = m[0];
    if (word === 'สิบ') {
      total += (current ?? 1) * 10; // "สิบ" เฉย ๆ = 10, "สามสิบ" = 30
      current = null;
    } else if (word === 'ร้อย') {
      total = (total + (current ?? 1)) * 100;
      current = null;
    } else {
      const digit = DIGITS[word];
      if (digit === undefined) return null;
      current = digit;
    }
  }
  if (consumed === 0 || consumed !== text.length) return null;
  return total + (current ?? 0);
}
