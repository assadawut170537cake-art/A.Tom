/**
 * ต่อ AgentHarness (core) เข้ากับ aiOrchestrator + moduleRegistry ของแอป
 * (core ห้าม import features จึงประกอบที่นี่)
 */

import { AgentHarness } from '../../core/agent/AgentHarness';
import type { AgentHarnessOptions, AgentLLM } from '../../core/agent/types';
import { moduleRegistry } from '../../core/modules/ModuleRegistry';
import { aiOrchestrator, type Orchestrator } from './core/Orchestrator';

/** LLM ของ agent: temperature 0 เพื่อให้ตอบ JSON คงที่ */
export function orchestratorLLM(orchestrator: Pick<Orchestrator, 'chat'> = aiOrchestrator): AgentLLM {
  return { chat: async (messages) => (await orchestrator.chat({ messages, temperature: 0 })).content };
}

export function createAppAgent(options: AgentHarnessOptions = {}): AgentHarness {
  return new AgentHarness(orchestratorLLM(), moduleRegistry, options);
}
