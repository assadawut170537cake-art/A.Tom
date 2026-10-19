/**
 * @file ลำดับการเปิดแอป (เรียกครั้งเดียวจาก App.tsx ก่อน render)
 *
 * 1. ลงทะเบียน AI + voice providers + sample agent "โน้ต" (sync — หน้าแรกต้องใช้ทันที)
 * 2. เริ่ม services แบบ async ไม่บล็อก UI:
 *    - โหลด module ใน `BOOT_MODULES` (src/modules/loader.ts — ตอนนี้คือ `pc-bridge`)
 *    - `moduleManager.start()` — ใช้ค่าเปิด/ปิด module ที่บอสบันทึกไว้ แล้ว `initAll()`
 *      (module ที่ล้ม/ทั้งหมดล้ม แค่ log แอปทำงานต่อได้)
 *    - นับ Shared Memory facts (ChatHandler ของแอปแนบ facts ใน system prompt ผ่าน `getAppRouter()`)
 *    - `memorySync.start()` — จับคู่ Mark 55 ไว้แล้ว → เริ่มคิว sync + ซิงก์ 1 รอบ · ยังไม่จับคู่ = ไม่ทำอะไร
 *    - `secretSync.importOnce()` — ดึง API key จาก Supermemory ใส่ SecureStore (ไม่มีคีย์ Supermemory = ข้าม · ล้มแค่ log)
 *    - `superMemorySync.start()` — ส่ง fact ที่แก้ขึ้น Supermemory เบื้องหลัง (ไม่มี API key = ไม่ส่ง · ล้มแค่ log)
 *    - `pcInbox.start()` — รับงานที่ Mark 55 ส่งหามือถือทุก 15s (ยังไม่ตั้งค่า Mark 55 Bus = ไม่เรียกอะไร)
 *    - `startChatSync()` — ห้องแชทเดียวกัน (ซิงก์แชทข้ามเครื่องเมื่อจับคู่ Mark 55 แล้ว · ไม่จับคู่ = ไม่ทำอะไร)
 *    - `__DEV__`: log จำนวน facts + ติดตั้งเครื่องมือทดสอบ memory/module (src/dev/)
 *
 * `bootApp()` เรียกซ้ำได้ (fast refresh) — ได้ promise เดิม ไม่ init ซ้ำ ไม่เพิ่มเมนู dev ซ้ำ
 */

import { localMemory } from './core/memory/LocalMemoryAdapter';
import { memorySync, type MemorySync } from './core/memory/MemorySync';
import { secretSync, type SecretSync } from './core/memory/SecretSync';
import { superMemorySync, type SuperMemorySyncService } from './core/memory/SuperMemorySync';
import { ALL_MEMORY_TARGETS, type MemoryStore } from './core/memory/types';
import { moduleManager, type ModuleManager } from './core/modules/ModuleManager';
import type { InitReport } from './core/modules/types';
import { installMemoryDevTools } from './dev/memoryDevTools';
import { installModuleDevTools } from './dev/moduleDevTools';
import { registerAIProviders } from './features/ai';
import { registerVoiceProviders } from './features/voice';
import { registerDeviceAgent } from './modules/agents/device-agent';
import { registerRouteEscortAgent } from './modules/agents/route-escort';
import { registerSampleAgents } from './modules/agents/sample-agent';
import { registerStandbyAgent } from './modules/agents/standby-agent';
import { registerTaskAgent } from './modules/agents/task-agent';
import { registerUltronAgent } from './modules/agents/ultron-agent';
import { loadBootModules } from './modules/loader';
import { startChatSync } from './features/chat/chatSyncBridge';
import { pcInbox } from './modules/pc-inbox';

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
  /** ไม่ส่ง = ไม่ส่งขึ้น Supermemory (test เดิม) */
  supermemory?: Pick<SuperMemorySyncService, 'start'>;
  /** ไม่ส่ง = ไม่ดึงคีย์จาก Supermemory (test เดิม) */
  secrets?: Pick<SecretSync, 'importOnce'>;
  /** ไม่ส่ง = ไม่ดึง inbox จาก Mark 55 (test เดิม) */
  inbox?: { start(): void };
  /** ไม่ส่ง = ไม่เริ่มห้องแชทเดียวกัน (test เดิม) */
  startChat?: () => void;
  /** โหลด module ก่อน start · ไม่ส่ง = ไม่โหลด (test เดิม) */
  loadModules?: () => Promise<void>;
}

const DEFAULT_DEPS: BootDeps = {
  modules: moduleManager,
  memory: localMemory,
  sync: memorySync,
  supermemory: superMemorySync,
  secrets: secretSync,
  inbox: pcInbox,
  startChat: () => void startChatSync(),
  loadModules: () => loadBootModules(),
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
  registerSampleAgents();
  registerRouteEscortAgent();
  registerStandbyAgent();
  registerUltronAgent();
  registerTaskAgent(); // ก่อนอุปกรณ์ — "เปิดแอป X แล้วพิมพ์…" ต้องมาที่นี่ก่อน
  registerDeviceAgent();
  return (started ??= startServices());
}

/** ไม่ reject เด็ดขาด — ทุกขั้นที่ล้มถูก log แล้วข้ามไป */
export async function startServices(deps: BootDeps = DEFAULT_DEPS): Promise<BootReport> {
  let modules: InitReport | null = null;
  try {
    await deps.loadModules?.(); // loadBootModules() ไม่ reject อยู่แล้ว — กันไว้อีกชั้น
  } catch (e) {
    console.error('[boot] โหลด module ไม่สำเร็จ', e);
  }
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
  try {
    await deps.secrets?.importOnce();
  } catch (e) {
    console.error('[boot] ดึงคีย์จาก Supermemory ไม่สำเร็จ — ใส่เองได้ตามปกติ', e);
  }
  try {
    deps.supermemory?.start();
  } catch (e) {
    console.error('[boot] เริ่มส่งขึ้น Supermemory ไม่สำเร็จ — แอปทำงานต่อได้', e);
  }
  try {
    deps.inbox?.start();
  } catch (e) {
    console.error('[boot] เริ่มรับงานจาก Mark 55 ไม่สำเร็จ — แอปทำงานต่อได้', e);
  }
  try {
    deps.startChat?.();
  } catch (e) {
    console.error('[boot] เริ่มห้องแชทเดียวกันไม่สำเร็จ — แชทเครื่องเดียวทำงานต่อได้', e);
  }

  if (deps.dev) {
    // log ช่วยทดสอบด้วยมือ (เฉพาะ dev) — ปกติโปรเจกต์นี้ใช้แค่ console.error
    console.info(
      `[boot] Shared Memory: ${memoryFacts ?? '?'} facts (แนบใน system prompt ทุกครั้งที่คุย) · ` +
        `modules พร้อม ${modules?.ready.length ?? 0} / ล้ม ${modules?.failed.length ?? 0}`,
    );
    try {
      deps.installDevTools(deps.memory);
    } catch (e) {
      console.error('[boot] ติดตั้งเครื่องมือ dev ไม่ได้', e);
    }
  }
  return { modules, memoryFacts };
}
