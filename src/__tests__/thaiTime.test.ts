import { cleanText, formatToday, formatWhen, parseThaiWhen } from '../features/today/thaiTime';

// อาทิตย์ 18 ต.ค. 2026 10:00 (เวลาเครื่อง)
const NOW = new Date(2026, 9, 18, 10, 0, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime();

const parse = (text: string) => parseThaiWhen(text, NOW);

describe('parseThaiWhen — เวลานับจากตอนนี้', () => {
  test.each([
    ['อีก 10 นาที ให้กินยา', NOW + 10 * 60_000, 'กินยา'],
    ['กินยาในอีก 10 นาที', NOW + 10 * 60_000, 'กินยา'],
    ['อีกครึ่งชั่วโมง โทรหาแม่', NOW + 30 * 60_000, 'โทรหาแม่'],
    ['อีก 2 ชั่วโมงครึ่ง ออกจากบ้าน', NOW + 150 * 60_000, 'ออกจากบ้าน'],
    ['อีกสามวัน จ่ายค่าไฟ', NOW + 3 * 24 * 3_600_000, 'จ่ายค่าไฟ'],
    ['ใน 5 นาที ปิดเตา', NOW + 5 * 60_000, 'ปิดเตา'],
    ['call mom in 15 minutes', NOW + 15 * 60_000, 'call mom'],
  ])('%s', (text, expectedAt, expectedText) => {
    expect(parse(text)).toEqual({ at: expectedAt, text: expectedText });
  });
});

describe('parseThaiWhen — วันและเวลา', () => {
  test.each([
    ['พรุ่งนี้ 9 โมง ประชุม', at(19, 9), 'ประชุม'],
    ['ประชุมพรุ่งนี้9โมงครึ่ง', at(19, 9, 30), 'ประชุม'],
    ['พรุ่งนี้บ่าย 3 ไปหาหมอ', at(19, 15), 'ไปหาหมอ'],
    ['บ่ายโมง กินข้าว', at(18, 13), 'กินข้าว'],
    ['2 ทุ่ม ดูบอล', at(18, 20), 'ดูบอล'],
    ['ตีห้า ตื่นไปวิ่ง', at(19, 5), 'ตื่นไปวิ่ง'],
    ['20:30 โทรหาลูกค้า', at(18, 20, 30), 'โทรหาลูกค้า'],
    ['8.15 น. ส่งงาน', at(19, 8, 15), 'ส่งงาน'],
    ['6 โมงเย็น รดน้ำต้นไม้', at(18, 18), 'รดน้ำต้นไม้'],
    ['4 โมง รับลูก', at(18, 16), 'รับลูก'],
    ['เที่ยง กินยา', at(18, 12), 'กินยา'],
    ['เที่ยงคืน ปิดไฟ', at(19, 0), 'ปิดไฟ'],
    ['พรุ่งนี้เช้า ซื้อของ', at(19, 8), 'ซื้อของ'],
    ['พรุ่งนี้เย็น 6 โมง เลี้ยงข้าว', at(19, 18), 'เลี้ยงข้าว'],
    ['คืนนี้ ส่งรายงาน', at(18, 20), 'ส่งรายงาน'],
    ['มะรืนนี้ จ่ายบิล', at(20, 9), 'จ่ายบิล'],
    ['วันจันทร์ 10 โมง ประชุมทีม', at(19, 10), 'ประชุมทีม'],
    ['ศุกร์นี้ บ่าย 2 โมง นัดหมอฟัน', at(23, 14), 'นัดหมอฟัน'],
    ['วันอาทิตย์ 9 โมง ตัดผม', at(25, 9), 'ตัดผม'],
    ['ตอน 9 โมงเช้า ให้โทรหาแบงก์ด้วยนะ', at(19, 9), 'โทรหาแบงก์'],
    ['gym at 7pm', at(18, 19), 'gym'],
  ])('%s', (text, expectedAt, expectedText) => {
    expect(parse(text)).toEqual({ at: expectedAt, text: expectedText });
  });

  test('ไม่บอกวันแล้วเวลาผ่านไปแล้ว → พรุ่งนี้', () => {
    expect(parse('9 โมง ตื่น')?.at).toBe(at(19, 9));
    expect(parse('11 โมง ตื่น')?.at).toBe(at(18, 11));
  });

  test('ไม่มีเวลาในประโยค → null', () => {
    expect(parse('ซื้อนม')).toBeNull();
    expect(parse('ส่งงานอาจารย์พุธ')).toBeNull();
  });
});

describe('cleanText / format', () => {
  test('ตัดคำเชื่อมหัวท้าย', () => {
    expect(cleanText('  ให้ กินยา ด้วยนะ ')).toBe('กินยา');
    expect(cleanText('ว่า ประชุม')).toBe('ประชุม');
    expect(cleanText('ให้')).toBe('');
  });

  test('formatWhen', () => {
    expect(formatWhen(at(18, 14, 5), NOW)).toBe('วันนี้ 14:05 น.');
    expect(formatWhen(at(19, 9), NOW)).toBe('พรุ่งนี้ 09:00 น.');
    expect(formatWhen(at(24, 9), NOW)).toBe('เสาร์ 24 ต.ค. 09:00 น.');
    expect(formatToday(NOW)).toBe('วันอาทิตย์ที่ 18 ตุลาคม');
  });
});
