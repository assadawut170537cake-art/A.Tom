/**
 * @file ลำดับการเปิดแอป (เรียกครั้งเดียวจาก App.tsx ก่อน render)
 *
 * 1. ลงทะเบียน AI + voice providers (sync — หน้าแรกต้องใช้ทันที)
 * 2. เริ่ม services แบบ async ไม่บล็อก UI:
 *    - `moduleRegistry.initAll()` — module ที่ล้ม/ทั้งหมดล้ม แค่ log แอปทำงานต่อได้
 *    - นับ Shared Memory facts (ChatHandler ของแอปแนบ facts ใน system prompt ผ่าน `getAppRouter()`)
 *    - `__DEV__`: log จำนวน facts + ติดตั้งเครื่องมือทดสอบ memory (src/dev/memoryDevTools.ts)
 *
 * `bootApp()` เรียกซ้ำได้ (fast refresh) — ได้ promise เดิม ไม่ init ซ้ำ ไม่เพิ่มเมนู dev ซ้ำ
 */

import { localMemory } from './core/memory/LocalMemoryAdapter';
import { ALL_MEMORY_TARGETS, type MemoryStore } from './core/memory/types';
import { moduleRegistry } from './core/modules/ModuleRegistry';
import type { InitReport } from './core/modules/types';
import { installMemoryDevTools } from './dev/memoryDevTools';
import { registerAIProviders } from './features/ai';
import { registerVoiceProviders } from './features/voice';

export interface BootReport {
  /** null = initAll() เองล้ม (log แล้ว) */
  modules: InitReport | null;
  /** จำนวน facts ทั้งหมด (global + ทุก persona); null = อ่าน memory ไม่ได้ */
  memoryFacts: number | null;
}

interface BootDeps {
  modules: Pick<typeof moduleRegistry, 'initAll'>;
  memory: MemoryStore;
  dev: boolean;
  installDevTools: (memory: MemoryStore) => unknown;
}

const DEFAULT_DEPS: BootDeps = {
  modules: moduleRegistry,
  memory: localMemory,
  dev: __DEV__,
  installDevTools: (memory) => installMemoryDevTools(memory),
};

let started: Promise<BootReport> | null = null;

export function bootApp(): Promise<BootReport> {
  registerAIProviders();
  registerVoiceProviders();
  return (started ??= startServices());
}

/** ไม่ reject เด็ดขาด — ทุกขั้นที่ล้มถูก log แล้วข้ามไป */
export async function startServices(deps: BootDeps = DEFAULT_DEPS): Promise<BootReport> {
  let modules: InitReport | null = null;
  try {
    modules = await deps.modules.initAll();
  } catch (e) {
    console.error('[boot] เริ่ม module ไม่สำเร็จ — แอปทำงานต่อได้ (ไม่มี module)', e);
  }

  let memoryFacts: number | null = null;
  try {
    const lists = await Promise.all(ALL_MEMORY_TARGETS.map((t) => deps.memory.list(t)));
    memoryFacts = lists.reduce((sum, list) => sum + list.length, 0);
  } catch (e) {
    console.error('[boot] อ่าน Shared Memory ไม่ได้ — คุยได้ตามปกติแต่ไม่มี facts', e);
  }

  if (deps.dev) {
    // log ช่วยทดสอบด้วยมือ (เฉพาะ dev) — ปกติโปรเจกต์นี้ใช้แค่ console.error
    console.info(
      `[boot] Shared Memory: ${memoryFacts ?? '?'} facts (แนบใน system prompt ทุกครั้งที่คุย) · ` +
        `modules พร้อม ${modules?.ready.length ?? 0} / ล้ม ${modules?.failed.length ?? 0}`
    );
    try {
      deps.installDevTools(deps.memory);
    } catch (e) {
      console.error('[boot] ติดตั้งเครื่องมือ dev ไม่ได้', e);
    }
  }
  return { modules, memoryFacts };
}
