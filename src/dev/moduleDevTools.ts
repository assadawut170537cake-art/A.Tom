/**
 * @file module ทดสอบสำหรับหน้า ตั้งค่า › Modules ระหว่างพัฒนา (เรียกจาก boot เฉพาะ `__DEV__`) — ไม่มีใน production build
 *
 * ตอนนี้ยังไม่มี module จริง (pc-bridge = Phase 4.5.5) หน้า Modules จึงว่าง — เครื่องมือนี้เพิ่ม module ปลอม 3 ตัว
 * ให้ลองเปิด/ปิด, dependency และ "เริ่มใหม่" บน emulator ได้:
 * - เมนู dev ของ React Native: "A.T.O.M.: เพิ่ม module ทดสอบ" (best-effort เหมือน memoryDevTools)
 * - console ของ React Native DevTools: `atomDev.addTestModules()`
 *
 * module ลงทะเบียนแค่ในหน่วยความจำ (reload แล้วหาย ต้องกดเพิ่มใหม่) แต่ค่าเปิด/ปิดที่บอสตั้งถูกจำไว้
 * → reload แล้วกดเพิ่มอีกครั้ง จะเห็นค่าเดิม (ทดสอบการจำค่าได้)
 */

import { DevSettings } from 'react-native';

import type { ModuleManager } from '../core/modules/ModuleManager';
import type { AtomModule } from '../core/modules/types';
import { isRecord } from '../core/types/guards';

export const DEV_TEST_MODULE_IDS = ['dev-transport', 'dev-pc-bridge', 'dev-flaky'] as const;

/**
 * transport ← pc-bridge (พึ่ง transport) · flaky = init ล้มรอบแรก สำเร็จเมื่อกด "เริ่มใหม่"
 * (init แบบ sync — flaky ที่ throw ทันทีคือกรณีที่เคยทำให้ registry init ซ้ำไม่ได้)
 */
export function createTestModules(): AtomModule[] {
  let flakyAttempts = 0;
  const noop = () => {};
  return [
    {
      id: 'dev-transport',
      name: 'ทดสอบ: Transport',
      description: 'module ฐานที่ module อื่นต้องใช้ — ลองปิดดูจะมีคำเตือน',
      enabled: true,
      init: noop,
      dispose: noop,
    },
    {
      id: 'dev-pc-bridge',
      name: 'ทดสอบ: PC Bridge',
      description: 'ต้องใช้ Transport — ลองปิด Transport แล้วเปิดตัวนี้ Transport จะเปิดตามให้',
      enabled: true,
      dependencies: ['dev-transport'],
      init: noop,
      dispose: noop,
    },
    {
      id: 'dev-flaky',
      name: 'ทดสอบ: เริ่มรอบแรกไม่สำเร็จ',
      description: 'init ล้มครั้งแรก — กด "เริ่มใหม่" แล้วจะทำงาน',
      enabled: true,
      init: () => {
        flakyAttempts += 1;
        if (flakyAttempts === 1) throw new Error('จำลอง: ต่ออุปกรณ์ไม่ได้');
      },
      dispose: noop,
    },
  ];
}

/** เพิ่มเฉพาะตัวที่ยังไม่มี (กดซ้ำได้) */
export async function addTestModules(manager: ModuleManager): Promise<void> {
  for (const module of createTestModules()) {
    if (!manager.get(module.id)) await manager.register(module);
  }
}

type DevMenu = Pick<typeof DevSettings, 'addMenuItem'>;

export function installModuleDevTools(manager: ModuleManager, devMenu: DevMenu = DevSettings): void {
  const addModules = () => addTestModules(manager);
  devMenu.addMenuItem('A.T.O.M.: เพิ่ม module ทดสอบ', () => {
    addModules().catch((e: unknown) => console.error('[dev] เพิ่ม module ทดสอบไม่สำเร็จ', e));
  });
  // ต่อท้าย atomDev ของ memoryDevTools (ติดตั้งก่อน) แทนการเขียนทับ
  const existing: unknown = Reflect.get(globalThis, 'atomDev');
  Object.assign(globalThis, { atomDev: { ...(isRecord(existing) ? existing : {}), addTestModules: addModules } });
}
