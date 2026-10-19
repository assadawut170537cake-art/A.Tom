/**
 * @file สัญญาของ Agent Harness — loop: คิด (LLM) → เรียก tool (module) → สังเกตผล → ... → ตอบบอส
 *
 * อยู่ใน core จึงไม่รู้จัก aiOrchestrator (features/ai) โดยตรง — รับ LLM ผ่าน {@link AgentLLM} (DI)
 * ตัวต่อของแอปอยู่ที่ features/ai/agent.ts (`createAppAgent()`)
 */

import type { MemoryStore } from '../memory/types';
import type { Persona } from '../types/persona';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM ที่ harness ใช้คิด — แอปส่ง aiOrchestrator เข้ามา */
export interface AgentLLM {
  chat(messages: AgentMessage[]): Promise<string>;
}

/** สิ่งที่ LLM ตัดสินใจในแต่ละ step */
export type AgentDecision =
  | {
      type: 'tool';
      tool: string;
      action?: string | undefined;
      target?: string | undefined;
      text?: string | undefined;
      /** argument แบบโครงสร้าง (เช่น MCP tool ที่มี inputSchema) */
      args?: Record<string, unknown> | undefined;
    }
  | { type: 'final'; reply: string };

export interface AgentToolCall {
  tool: string;
  action?: string | undefined;
  target?: string | undefined;
  text: string;
  args?: Record<string, unknown> | undefined;
}

/** ที่มาของ tool ที่ agent เห็น */
export type AgentToolSource = 'module' | 'mcp' | 'skill' | 'device';

export interface AgentToolSpec {
  id: string;
  name: string;
  description?: string | undefined;
  source: AgentToolSource;
}

/**
 * แหล่ง tool เพิ่มเติมนอก ModuleRegistry (MCP / Skill / Device) — `listTools()` เป็น sync (คืนจาก cache)
 * เพื่อให้สร้าง prompt ได้ทันที · `call()` ต้องไม่ throw (คืน ok:false แทน)
 */
export interface AgentToolProvider {
  listTools(): AgentToolSpec[];
  call(call: AgentToolCall): Promise<AgentToolResult>;
}

export interface AgentToolResult {
  ok: boolean;
  /** ผลที่ส่งกลับให้ LLM (ผ่าน redactSecrets แล้ว) */
  output: string;
  /** true = ยังไม่ได้ทำ เพราะต้องให้บอสยืนยันก่อน (เรียกซ้ำด้วย `args.confirmed: true`) */
  needsConfirmation?: boolean | undefined;
}

export interface AgentStep {
  index: number;
  decision: AgentDecision;
  toolCall?: AgentToolCall | undefined;
  toolResult?: AgentToolResult | undefined;
}

export type AgentStopReason = 'final' | 'max_steps';

export interface AgentRunInput {
  text: string;
  /** intent จาก IntentRouter (ถ้ามี) — แนบให้ LLM รู้บริบท */
  intent?: string | undefined;
  /** system prompt ของ persona (ถ้ามี) */
  systemPrompt?: string | undefined;
  /** persona ที่คุยอยู่ — ใช้เลือก memory facts (global + persona นี้) */
  persona?: Persona | undefined;
}

export interface AgentRunResult {
  input: AgentRunInput;
  reply: string;
  steps: AgentStep[];
  stopReason: AgentStopReason;
}

export interface AgentHooks {
  onStart?(input: AgentRunInput): void | Promise<void>;
  onStep?(step: AgentStep): void | Promise<void>;
  onToolCall?(call: AgentToolCall, result: AgentToolResult): void | Promise<void>;
  onComplete?(result: AgentRunResult): void | Promise<void>;
  onError?(error: unknown, steps: readonly AgentStep[]): void | Promise<void>;
}

export interface AgentHarnessOptions {
  /** กัน loop ไม่รู้จบ — default {@link DEFAULT_MAX_STEPS} */
  maxSteps?: number | undefined;
  hooks?: AgentHooks | undefined;
  /** แหล่ง tool นอก ModuleRegistry (ลำดับ = ลำดับความสำคัญเมื่อ id ซ้ำ; module มาก่อนเสมอ) */
  providers?: readonly AgentToolProvider[] | undefined;
  /** Shared Memory → แนบ facts เป็น context (อ่านไม่ได้ = ทำงานต่อโดยไม่มี facts) */
  memory?: MemoryStore | undefined;
}
