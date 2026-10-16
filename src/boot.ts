/**
 * @file ลำดับการเปิดแอป (เรียกครั้งเดียวจาก App.tsx ก่อน render)
 *
 * 1. ลงทะเบียน AI + voice providers (sync — หน้าแรกต้องใช้ทันที)
 * 2. เริ่ม services แบบ async ไม่บล็อก UI:
 *    - `moduleManager.start()` — ใช้ค่าเปิด/ปิด module ที่บอสบันทึกไว้ แล้ว `initAll()`
 *      (module ที่ล้ม/ทั้งหมดล้ม แค่ log แอปทำงานต่อได้)
 *    - นับ Shared Memory facts (ChatHandler ของแอปแนบ facts ใน system prompt ผ่าน `getAppRouter()`)
 *    - `memorySync.start()` — จับคู่ Mark 55 ไว้แล้ว → เริ่มคิว sync + ซิงก์ 1 รอบ · ยังไม่จับคู่ = ไม่ทำอะไร
 *    - `__DEV__`: log จำนวน facts + ติดตั้งเครื่องมือทดสอบ memory/module (src/dev/)
 *
 * `bootApp()` เรียกซ้ำได้ (fast refresh) — ได้ promise เดิม ไม่ init ซ้ำ ไม่เพิ่มเมนู dev ซ้ำ
 */

import { localMemory } from './core/memory/LocalMemoryAdapter';
import { memorySync, type MemorySync } from './core/memory/MemorySync';
import { ALL_MEMORY_TARGETS, type MemoryStore } from './core/memory/types';
import { moduleManager, type ModuleManager } from './core/modules/ModuleManager';
import type { InitReport } from './core/modules/types';
import { installMemoryDevTools } from './dev/memoryDevTools';
import { installModuleDevTools } from './dev/moduleDevTools';
import { registerAIProviders } from './features/ai';
import { registerVoiceProviders } from './features/voice';
import { agentRegistry } from './core/agents/AgentRegistry';
import { routeEscortAgent } from './modules/agents/route-escort';

export interface BootReport {
  /** null = start() เองล้ม (log แล้ว) */
  modules: InitReport | null;
  /** จำนวน facts ทั้งหมด (global + ทุก persona); null = อ่าน memory ไม่ได้ */
  memoryFacts: number | null;
}

interface BootDeps {
  modules: Pick<ModuleManager, 'start'>;
  memory: MemoryStore;
  dev: boolean;
  installDevTools: (memory: MemoryStore) => unknown;
  /** ไม่ส่ง = ไม่เริ่ม sync (test เดิม) */
  sync?: Pick<MemorySync, 'start'>;
}

const DEFAULT_DEPS: BootDeps = {
  modules: moduleManager,
  memory: localMemory,
  sync: memorySync,
  dev: __DEV__,
  installDevTools: (memory) => {
    installMemoryDevTools(memory);
    installModuleDevTools(moduleManager);
  },
};

let started: Promise<BootReport> | null = null;

export function bootApp(): Promise<BootReport> {
  registerAIProviders();
  registerVoiceProviders();
  try {
    agentRegistry.register(routeEscortAgent);
  } catch (e) {
    console.error('[boot] ลงทะเบียน routeEscortAgent ไม่สำเร็จ', e);
  }
  return (started ??= startServices());
}

/** ไม่ reject เด็ดขาด — ทุกขั้นที่ล้มถูก log แล้วข้ามไป */
export async function startServices(deps: BootDeps = DEFAULT_DEPS): Promise<BootReport> {
  let modules: InitReport | null = null;
  try {
    modules = await deps.modules.start();
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

  try {
    await deps.sync?.start(); // start() ไม่ reject อยู่แล้ว — กันไว้อีกชั้น
  } catch (e) {
    console.error('[boot] เริ่ม Sync ไม่สำเร็จ — ใช้ Shared Memory แบบเครื่องเดียว', e);
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
