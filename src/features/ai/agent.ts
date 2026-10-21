/**
 * ต่อ AgentHarness (core) เข้ากับ aiOrchestrator + moduleRegistry + MCP / Skills / Device + Shared Memory ของแอป
 * (core ห้าม import features จึงประกอบที่นี่)
 */

import { AgentHarness } from '../../core/agent/AgentHarness';
import { deviceControl } from '../../core/agent/DeviceControlBridge';
import { mcpBridge } from '../../core/agent/MCPClientBridge';
import { skillEngine } from '../../core/agent/SkillEngine';
import type { AgentHarnessOptions, AgentHooks, AgentLLM } from '../../core/agent/types';
import { localMemory } from '../../core/memory/LocalMemoryAdapter';
import { moduleRegistry } from '../../core/modules/ModuleRegistry';
import { aiOrchestrator, type Orchestrator } from './core/Orchestrator';
import { createDiscoveryTool } from './discoveryTool';

/** LLM ของ agent: temperature 0 เพื่อให้ตอบ JSON คงที่ */
export function orchestratorLLM(
  orchestrator: Pick<Orchestrator, 'chat'> = aiOrchestrator,
): AgentLLM {
  return {
    chat: async (messages) => (await orchestrator.chat({ messages, temperature: 0 })).content,
  };
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
 * `learn` = ให้ SkillEngine สังเคราะห์ทักษะใหม่หลังงานสำเร็จ · ไม่ส่งมา = ตามค่าที่บอสตั้ง
 * (Boss อนุมัติ 2026-10-20 → ค่าเริ่มต้นเปิด) · ทักษะที่เขียนขึ้นยัง `enabled:false` รอบอสเปิดใช้เอง
 */
export async function createAppAgent(
  options: AgentHarnessOptions & { learn?: boolean | undefined } = {},
): Promise<AgentHarness> {
  const { learn, hooks, ...rest } = options;
  await Promise.all([skillEngine.load(), deviceControl.load(), mcpBridge.connectAll()]);
  const llm = orchestratorLLM();
  const learnOn = learn ?? (await skillEngine.isLearnEnabled());
  return new AgentHarness(llm, moduleRegistry, {
    // discovery = ค้นหาความสามารถ (ทักษะ/MCP) ก่อน แล้วจึงเป็นแหล่ง tool จริง — ค้นอย่างเดียว ไม่ติดตั้ง
    providers: [createDiscoveryTool(), skillEngine, mcpBridge, deviceControl],
    memory: localMemory,
    ...rest,
    hooks: combineHooks(skillEngine.hooks(learnOn ? llm : undefined), hooks),
  });
}
