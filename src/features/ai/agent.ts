/**
 * ต่อ AgentHarness (core) เข้ากับ aiOrchestrator + moduleRegistry + MCP / Skills / Device + Shared Memory ของแอป
 * (core ห้าม import features จึงประกอบที่นี่)
 */

import { AgentHarness } from '../../core/agent/AgentHarness';
import { deviceControl } from '../../core/agent/DeviceControlBridge';
import { mcpBridge } from '../../core/agent/MCPClientBridge';
import { skillEngine } from '../../core/agent/SkillEngine';
import type { AgentHarnessOptions, AgentHooks, AgentLLM, AgentRunInput } from '../../core/agent/types';
import { localMemory } from '../../core/memory/LocalMemoryAdapter';
import { moduleRegistry } from '../../core/modules/ModuleRegistry';
import { aiOrchestrator, type Orchestrator } from './core/Orchestrator';

/** LLM ของ agent: temperature 0 เพื่อให้ตอบ JSON คงที่ */
export function orchestratorLLM(orchestrator: Pick<Orchestrator, 'chat'> = aiOrchestrator): AgentLLM {
  return { chat: async (messages) => (await orchestrator.chat({ messages, temperature: 0 })).content };
}

/** รวม hooks หลายชุดเป็นชุดเดียว (เรียกตามลำดับ) */
export function combineHooks(...sets: (AgentHooks | undefined)[]): AgentHooks {
  const list = sets.filter((h): h is AgentHooks => h !== undefined);
  return {
    onStart: async (...a) => {
      for (const h of list) await h.onStart?.(...a);
    },
    onStep: async (...a) => {
      for (const h of list) await h.onStep?.(...a);
    },
    onToolCall: async (...a) => {
      for (const h of list) await h.onToolCall?.(...a);
    },
    onComplete: async (...a) => {
      for (const h of list) await h.onComplete?.(...a);
    },
    onError: async (...a) => {
      for (const h of list) await h.onError?.(...a);
    },
  };
}

/**
 * agent ของแอป — โหลดรายการ skill / device / MCP ก่อน (listTools ของแต่ละตัวอ่านจาก cache)
 * `learn: true` = ให้ SkillEngine สังเคราะห์ทักษะใหม่หลังงานสำเร็จ (ปิดไว้ รอบอสอนุมัติ)
 */
export async function createAppAgent(
  options: AgentHarnessOptions & { learn?: boolean | undefined } = {}
): Promise<AgentHarness> {
  const { learn, hooks, ...rest } = options;
  await Promise.all([skillEngine.load(), deviceControl.load(), mcpBridge.connectAll()]);
  const llm = orchestratorLLM();
  return new AgentHarness(llm, moduleRegistry, {
    providers: [skillEngine, mcpBridge, deviceControl],
    memory: localMemory,
    ...rest,
    hooks: combineHooks(skillEngine.hooks(learn ? llm : undefined), hooks),
  });
}

/** สร้าง harness ใหม่หลังจากนี้ — บอสเปิด/ปิด MCP หรือทักษะ แล้วแชทจะเห็นภายในไม่กี่นาที */
const CHAT_AGENT_TTL_MS = 2 * 60 * 1000;

export interface ChatToolAgent {
  /** มี tool นอก module (MCP / ทักษะ / ควบคุมเครื่อง) เปิดอยู่ไหม — ไม่มี = แชทแบบปกติ */
  hasTools(): Promise<boolean>;
  /** คำตอบสุดท้ายของ agent — throw เมื่อ LLM ล้ม */
  run(input: AgentRunInput): Promise<string>;
}

/**
 * agent สำหรับแชท: ChatHandler ใช้เมื่อบอสเปิด tool ไว้ (ไม่งั้นแชทปกติ — ไหลทีละส่วน + ค้นเว็บได้)
 * module (เช่น pc-bridge) ไม่นับ เพราะมี intent ของตัวเองอยู่แล้ว
 */
export function createChatToolAgent(build: () => Promise<AgentHarness> = () => createAppAgent()): ChatToolAgent {
  let harness: Promise<AgentHarness> | null = null;
  let builtAt = 0;
  const get = () => {
    if (!harness || Date.now() - builtAt > CHAT_AGENT_TTL_MS) {
      builtAt = Date.now();
      const pending = build().catch((e: unknown) => {
        if (harness === pending) harness = null; // ครั้งหน้าลองใหม่
        throw e;
      });
      harness = pending;
    }
    return harness;
  };
  return {
    async hasTools() {
      return (await get()).availableTools().some((t) => t.source !== 'module');
    },
    async run(input) {
      return (await (await get()).run(input)).reply;
    },
  };
}
