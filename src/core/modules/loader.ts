/**
 * @file โหลด module ตาม id แบบ lazy — **STUB** (ยังไม่มี module ให้โหลด)
 *
 * Metro (React Native bundler) resolve ได้เฉพาะ `import('...')` ที่เป็น string คงที่
 * จึงต้องลงทะเบียน factory ของแต่ละ id ไว้ใน {@link MODULE_LOADERS} ล่วงหน้า แทนการต่อ path เอง
 *
 * TODO(phase-4.5):
 *   - เพิ่ม `'pc-bridge': () => import('../../features/pc-bridge').then((m) => m.default)`
 *     เมื่อ module แรกพร้อม (และพิจารณาย้ายตาราง loader ไปไว้ระดับแอป เพราะ core ไม่ควร import features)
 *   - โหลด module ที่บอสเปิดไว้ตอนเปิดแอป แล้วเรียก moduleRegistry.initAll()
 */

import { moduleRegistry, type ModuleRegistry } from './ModuleRegistry';
import type { AtomModule } from './types';

export type ModuleFactory = () => Promise<AtomModule>;

/** id → lazy factory. Empty until the first real module lands (see TODO above). */
export const MODULE_LOADERS: Readonly<Record<string, ModuleFactory>> = {};

/**
 * Registered module for `id`, loading and registering it first if needed.
 * Rejects when no loader exists for `id` (Phase 4.5+) or the loaded module has another id.
 */
export async function loadModule(
  id: string,
  registry: ModuleRegistry = moduleRegistry,
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
  registry.register(module);
  return module;
}
