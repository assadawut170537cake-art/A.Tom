import { ORB_HTML, ORB_VARIANTS } from '../features/jarvis/constants/orbHtml';

const PERSONAS = [1, 2, 3, 4] as const;

/** รันสคริปต์ในหน้า Orb ด้วย DOM ปลอม (ไม่มี WebGL → ไม่วาด แต่ bridge ใช้ได้) */
function loadOrbPage() {
  const script = /<script>([\s\S]*)<\/script>/.exec(ORB_HTML)?.[1] ?? '';
  const el = () => ({ style: {}, getContext: () => null, addEventListener: () => undefined });
  const win: Record<string, unknown> = { devicePixelRatio: 1 };
  const doc = { getElementById: el, addEventListener: () => undefined, hidden: false };
  new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', script)(
    win,
    doc,
    () => 0,
    () => undefined
  );
  return win as {
    setOrbPersona: (p: number) => void;
    __orbVariant?: Record<string, number>;
  };
}

describe('Orb variants ต่อ persona', () => {
  test('ทั้ง 4 persona มี variant ต่างกัน', () => {
    const keys = PERSONAS.map((p) => JSON.stringify(ORB_VARIANTS[p]));
    expect(new Set(keys).size).toBe(4);
  });

  test('ลักษณะตรงตามสเปก: อะตอมหยาบ/ช้า · จาร์วิสเนียน · ไฟรเดย์คม/เร็ว · อัลตรอนกระตุก/พัลส์แรง', () => {
    const [atom, jarvis, friday, ultron] = PERSONAS.map((p) => ORB_VARIANTS[p]);
    if (!atom || !jarvis || !friday || !ultron) throw new Error('variant หาย');
    expect(atom.facet).toBe(1);
    expect(jarvis.facet).toBe(0);
    expect(jarvis.stutter).toBe(0);
    expect(atom.spin).toBeLessThan(friday.spin);
    expect(friday.sharp).toBeGreaterThan(jarvis.sharp);
    expect(ultron.stutter).toBeGreaterThan(0.5);
    expect(ultron.pulse).toBeGreaterThan(Math.max(atom.pulse, jarvis.pulse, friday.pulse));
  });

  test('page ฝังตาราง variant ครบ และ shader ใช้ uniform ใหม่', () => {
    expect(ORB_HTML).toContain(JSON.stringify(ORB_VARIANTS));
    for (const u of ['uFacet', 'uFreq', 'uSharp', 'uGloss', 'uPulseMul']) expect(ORB_HTML).toContain(u);
  });

  test('facet ใช้มุมละ 2π/9 พอดี — มุมสุดท้ายทับมุมแรก ไม่มีรอยต่อที่ ±π', () => {
    const s = /float S=([\d.]+);/.exec(ORB_HTML)?.[1];
    expect(Number(s)).toBeCloseTo((2 * Math.PI) / 9, 6);
    expect(ORB_HTML).not.toContain('floor(ang0/0.6981+0.5)'); // แบบเดิมปัดมุมเป็นขั้น → รอยแฉก
  });

  test('setOrbPersona(p) สลับ variant ตาม persona', () => {
    const page = loadOrbPage();
    for (const p of PERSONAS) {
      page.setOrbPersona(p);
      expect(page.__orbVariant).toEqual(ORB_VARIANTS[p]);
    }
    // persona ที่ไม่รู้จักถูกเมิน — variant เดิมอยู่
    page.setOrbPersona(99);
    expect(page.__orbVariant).toEqual(ORB_VARIANTS[4]);
  });
});
