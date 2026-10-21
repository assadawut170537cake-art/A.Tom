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
 *    - `pcInbox.start()` — รับงานที่ Mark 55 ส่งหามือถือทุก 15s (ยังไม่ตั้งค่า Mark 55 Bus = ไม่เรียกอะไร)
 *    - `startChatSync()` — ห้องแชทเดียวกัน (ซิงก์แชทข้ามเครื่องเมื่อจับคู่ Mark 55 แล้ว · ไม่จับคู่ = ไม่ทำอะไร)
 *    - `__DEV__`: log จำนวน facts + ติดตั้งเครื่องมือทดสอบ memory/module (src/dev/)
 *
 * `bootApp()` เรียกซ้ำได้ (fast refresh) — ได้ promise เดิม ไม่ init ซ้ำ ไม่เพิ่มเมนู dev ซ้ำ
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { localMemory } from './core/memory/LocalMemoryAdapter';
import { memorySync, type MemorySync } from './core/memory/MemorySync';
import { ALL_MEMORY_TARGETS, type MemoryStore } from './core/memory/types';
import { moduleManager, type ModuleManager } from './core/modules/ModuleManager';
import type { InitReport } from './core/modules/types';
import { recordRepair } from './core/selfRepair/SelfRepair';
import { SettingsHealth } from './core/selfRepair/SettingsHealth';
import { SnapshotStore } from './core/selfRepair/SnapshotStore';
import { installMemoryDevTools } from './dev/memoryDevTools';
import { installModuleDevTools } from './dev/moduleDevTools';
import { registerAIProviders } from './features/ai';
import { registerCustomProviders } from './features/ai/customProviders';
import { useAtomStore } from './features/jarvis/stores/useAtomStore';
import { settingsHealthEntries } from './features/settings/settingsHealthEntries';
import { loadAssistantData, registerAssistantAgents } from './features/assistant';
import { composeBriefing } from './features/assistant/agents/reminder';
import { setupNotifications } from './features/assistant/notifications';
import { registerVoiceProviders } from './features/voice';
import { registerDeviceAgent } from './modules/agents/device-agent';
import { registerNotebookLMAgent } from './modules/agents/notebooklm-agent';
import { registerRouteEscortAgent } from './modules/agents/route-escort';
import { registerSampleAgents } from './modules/agents/sample-agent';
import { registerStandbyAgent } from './modules/agents/standby-agent';
import { registerTaskAgent } from './modules/agents/task-agent';
import { registerTodayAgent } from './modules/agents/today-agent';
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
  /** ไม่ส่ง = ไม่ดึง inbox จาก Mark 55 (test เดิม) */
  inbox?: { start(): void };
  /** ไม่ส่ง = ไม่เริ่มห้องแชทเดียวกัน (test เดิม) */
  startChat?: () => void;
  /** โหลด module ก่อน start · ไม่ส่ง = ไม่โหลด (test เดิม) */
  loadModules?: () => Promise<void>;
  /** ตรวจ+กู้การตั้งค่าที่เสีย (ครั้งเดียวต่อ boot) · ไม่ส่ง = ข้าม (test เดิม) */
  checkSettings?: () => Promise<void>;
}

const DEFAULT_DEPS: BootDeps = {
  modules: moduleManager,
  memory: localMemory,
  sync: memorySync,
  inbox: pcInbox,
  startChat: () => void startChatSync(),
  loadModules: () => loadBootModules(),
  checkSettings: () => runSettingsHealth(),
  dev: __DEV__,
  installDevTools: (memory) => {
    installMemoryDevTools(memory);
    installModuleDevTools(moduleManager);
  },
};

let started: Promise<BootReport> | null = null;

export function bootApp(): Promise<BootReport> {
  registerAIProviders();
  void registerCustomProviders(); // ไม่ reject · โหลดเสร็จก่อนบอสพิมพ์ข้อความแรกแทบเสมอ
  registerVoiceProviders();
  registerSampleAgents();
  registerRouteEscortAgent();
  registerStandbyAgent();
  registerUltronAgent();
  registerNotebookLMAgent();
  registerTodayAgent();
  // ผู้ช่วยส่วนตัว (ปลุก/ปฏิทิน/โทร/อากาศ/รูป/Home Assistant) — ก่อน task/device ให้ pattern เฉพาะเจาะจงได้ก่อน
  registerAssistantAgents();
  void loadAssistantData().catch((e: unknown) =>
    console.error('[boot] โหลดผู้ช่วยที่สร้างเองไม่สำเร็จ', e),
  );
  // แตะแจ้งเตือนสรุปเช้า → ให้ผู้ช่วยสรุปให้ทันที (ผลขึ้นเป็นข้อความในแชท)
  setupNotifications(() => {
    void composeBriefing().then((content) => {
      const store = useAtomStore.getState();
      store.setUIMode('conversation');
      store.pushMessage({ role: 'assistant', content });
    });
  });
  registerTaskAgent(); // ก่อนอุปกรณ์ — "เปิดแอป X แล้วพิมพ์…" ต้องมาที่นี่ก่อน
  registerDeviceAgent();
  return (started ??= startServices());
}

/** ตรวจ+กู้การตั้งค่าที่เสีย 1 รอบ · แจ้งบอสในแชทเมื่อซ่อมของจริง (ข้อความระบบถาวร) */
async function runSettingsHealth(): Promise<void> {
  const health = new SettingsHealth({
    snapshots: new SnapshotStore(),
    kv: AsyncStorage,
    notify: (content) => void useAtomStore.getState().pushMessage({ role: 'system', content }),
    log: recordRepair,
  });
  await health.check(settingsHealthEntries());
}

/** ไม่ reject เด็ดขาด — ทุกขั้นที่ล้มถูก log แล้วข้ามไป */
export async function startServices(deps: BootDeps = DEFAULT_DEPS): Promise<BootReport> {
  // ตรวจ+กู้การตั้งค่าที่เสีย "ก่อน" module/consumer อ่าน blob → ซ่อมมีผลในรอบ boot นี้เลย (ครั้งเดียว · ไม่ reject)
  try {
    await deps.checkSettings?.();
  } catch (e) {
    console.error('[boot] ตรวจ/ซ่อมการตั้งค่าไม่สำเร็จ — แอปทำงานต่อได้', e);
  }

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
  // supermemory (ดึงคีย์ + ส่งขึ้น Supermemory) ย้ายเป็น module 'supermemory' แล้ว — init ผ่าน moduleManager.start()
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
