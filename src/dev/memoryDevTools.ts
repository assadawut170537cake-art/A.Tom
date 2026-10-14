/**
 * @file เครื่องมือทดสอบ Shared Memory ระหว่างพัฒนา (เรียกจาก boot เฉพาะ `__DEV__`) — ไม่มีใน production build
 *
 * - เมนู dev ของ React Native: "A.T.O.M.: เพิ่ม fact ทดสอบ" / "A.T.O.M.: ล้าง fact ทดสอบ"
 *   (best-effort: เมนูของ Expo บางรุ่นอาจไม่แสดงรายการที่เพิ่มผ่าน DevSettings)
 * - console ของ React Native DevTools (กด `j` ใน Expo CLI): `atomDev.seed()`, `atomDev.clear()`, `atomDev.list()`
 *
 * TODO(phase-4.5): แทนด้วยหน้า UI Memory จริง (Parking Lot ข้อ 7)
 */

import { DevSettings } from 'react-native';

import { ALL_MEMORY_TARGETS, type MemoryFact, type MemoryStore, type MemoryTarget } from '../core/memory/types';

/** fact ทดสอบ: global 1 ตัว + เฉพาะอะตอม 1 ตัว (ถามแล้วควรตอบตามนี้) */
export const DEV_TEST_FACTS: readonly { target: MemoryTarget; key: string; value: string }[] = [
  { target: { scope: 'global' }, key: 'dev_drink', value: 'บอสชอบกาแฟดำ ไม่ใส่น้ำตาล' },
  { target: { scope: 'persona', persona: 1 }, key: 'dev_atom_nickname', value: 'อะตอมเรียกบอสว่า "ลูกพี่เค้ก"' },
];

export async function seedTestFacts(memory: MemoryStore): Promise<void> {
  for (const f of DEV_TEST_FACTS) await memory.save(f.target, f.key, f.value, 'system');
}

/** ลบเฉพาะ fact ทดสอบ — fact จริงของบอสไม่โดน */
export async function clearTestFacts(memory: MemoryStore): Promise<void> {
  for (const f of DEV_TEST_FACTS) await memory.remove(f.target, f.key);
}

export async function listAllFacts(memory: MemoryStore): Promise<MemoryFact[]> {
  const lists = await Promise.all(ALL_MEMORY_TARGETS.map((t) => memory.list(t)));
  return lists.flat();
}

export interface AtomDevTools {
  seed: () => Promise<void>;
  clear: () => Promise<void>;
  list: () => Promise<MemoryFact[]>;
}

type DevMenu = Pick<typeof DevSettings, 'addMenuItem'>;

export function installMemoryDevTools(memory: MemoryStore, devMenu: DevMenu = DevSettings): AtomDevTools {
  const report = (action: string) => (e: unknown) => console.error(`[dev] ${action} fact ทดสอบไม่สำเร็จ`, e);
  const tools: AtomDevTools = {
    seed: () => seedTestFacts(memory),
    clear: () => clearTestFacts(memory),
    list: () => listAllFacts(memory),
  };
  devMenu.addMenuItem('A.T.O.M.: เพิ่ม fact ทดสอบ', () => {
    tools.seed().catch(report('เพิ่ม'));
  });
  devMenu.addMenuItem('A.T.O.M.: ล้าง fact ทดสอบ', () => {
    tools.clear().catch(report('ล้าง'));
  });
  Object.assign(globalThis, { atomDev: tools });
  return tools;
}
