/**
 * @file โหลด module ตาม id แบบ lazy — **STUB** (ยังไม่มี module ให้โหลด)
 *
 * อยู่ระดับแอป (`src/modules/`) ไม่ใช่ `core/modules/` เพราะตาราง loader ต้อง import module จริง
 * จาก `features/` — ถ้าอยู่ใน core จะผิดทิศทาง dependency (core → features)
 * ส่วนสัญญา (`AtomModule`) และ `ModuleRegistry` ยังอยู่ใน core
 *
 * Metro (React Native bundler) resolve ได้เฉพาะ `import('...')` ที่เป็น string คงที่
 * จึงต้องลงทะเบียน factory ของแต่ละ id ไว้ใน {@link MODULE_LOADERS} ล่วงหน้า แทนการต่อ path เอง
 *
 * ลงทะเบียนผ่าน `moduleManager` (ค่าเริ่มต้น) → ค่าเปิด/ปิดที่บอสบันทึกไว้มีผลทันที และ init ให้ถ้าเปิดอยู่
 *
 * TODO(phase-4.5):
 *   - เพิ่ม `'pc-bridge': () => import('../features/pc-bridge').then((m) => m.default)` เมื่อ module แรกพร้อม
 *   - โหลด module ที่บอสเปิดไว้ตอนเปิดแอป ก่อน `moduleManager.start()` (src/boot.ts)
 */

import { moduleManager } from '../core/modules/ModuleManager';
import type { ModuleRegistry } from '../core/modules/ModuleRegistry';
import type { AtomModule } from '../core/modules/types';

export type ModuleFactory = () => Promise<AtomModule>;

/** ที่ลงทะเบียน module: แอปใช้ ModuleManager (จำค่าเปิด/ปิด) · test ส่ง ModuleRegistry ตรง ๆ ได้ */
export interface ModuleHost {
  get: ModuleRegistry['get'];
  register(module: AtomModule): void | Promise<void>;
}

/** id → lazy factory. Empty until the first real module lands (see TODO above). */
export const MODULE_LOADERS: Readonly<Record<string, ModuleFactory>> = {};

/**
 * Registered module for `id`, loading and registering it first if needed.
 * Rejects when no loader exists for `id` (Phase 4.5+) or the loaded module has another id.
 */
export async function loadModule(
  id: string,
  registry: ModuleHost = moduleManager,
  loaders: Readonly<Record<string, ModuleFactory>> = MODULE_LOADERS
): Promise<AtomModule> {
  const existing = registry.get(id);
  if (existing) return existing;
  const factory = loaders[id];
  if (!factory) {
    throw new Error(`[modules] ยังไม่มี loader สำหรับ "${id}" — Not implemented (Phase 4.5+)`);
  }
  const module = await factory();
  if (module.id !== id) {
    throw new Error(`[modules] loader ของ "${id}" คืน module "${module.id}"`);
  }
  await registry.register(module);
  return module;
}
