/**
 * @file สัญญาของ Agent Harness — loop: คิด (LLM) → เรียก tool (module) → สังเกตผล → ... → ตอบบอส
 *
 * อยู่ใน core จึงไม่รู้จัก aiOrchestrator (features/ai) โดยตรง — รับ LLM ผ่าน {@link AgentLLM} (DI)
 * ตัวต่อของแอปอยู่ที่ features/ai/agent.ts (`createAppAgent()`)
 */

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
  | { type: 'tool'; tool: string; action?: string | undefined; target?: string | undefined; text?: string | undefined }
  | { type: 'final'; reply: string };

export interface AgentToolCall {
  tool: string;
  action?: string | undefined;
  target?: string | undefined;
  text: string;
}

export interface AgentToolResult {
  ok: boolean;
  /** ผลที่ส่งกลับให้ LLM (ผ่าน redactSecrets แล้ว) */
  output: string;
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
}

export interface AgentRunResult {
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
}
