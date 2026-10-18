import { PERSONAS } from '../features/jarvis/constants';

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance */
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

/** อัตราส่วน contrast เทียบพื้นดำ */
const contrastOnBlack = (hex: string) => (luminance(hex) + 0.05) / 0.05;

describe('สี persona (Phase 2 lock — Boss อนุมัติเปลี่ยน Atom/Ultron)', () => {
  test('Atom = ส้มสว่าง, Ultron = แดงเลือดหมูเข้ม', () => {
    expect(PERSONAS[1].color).toBe('#E67E22');
    expect(PERSONAS[4].color).toBe('#C0392B');
  });

  test('ทุก persona มี contrast ≥ 3:1 บนพื้นดำ', () => {
    for (const p of Object.values(PERSONAS)) {
      expect(contrastOnBlack(p.color)).toBeGreaterThanOrEqual(3);
    }
  });

  test('Atom กับ Ultron ต่างกันชัด (ความสว่างต่างกันเกิน 1.5 เท่า)', () => {
    const a = luminance(PERSONAS[1].color);
    const u = luminance(PERSONAS[4].color);
    expect((a + 0.05) / (u + 0.05)).toBeGreaterThan(1.5);
  });
});
