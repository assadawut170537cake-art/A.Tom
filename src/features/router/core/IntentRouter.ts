/**
 * @file Intent Router — ตัดสินว่าข้อความของบอส "ต้องการอะไร" แล้วส่งให้ handler ที่ถูกตัว
 *
 * ลำดับการจำแนก (หยุดที่ขั้นแรกที่ได้คำตอบ):
 *
 * ```
 * RuleClassifier (regex, ฟรี, ใช้ได้แม้ออฟไลน์)
 *   → AgentClassifier (pattern ของ agent ที่ลงทะเบียนไว้, ฟรี — ไม่มี agent = ข้าม)
 *     → JevClassifier (เฉพาะเมื่อเปิด Jev, confidence ≥ 0.7)
 *       → LLMClassifier (ถาม AI Orchestrator ให้ตอบ JSON)
 *         → default: chat
 * ```
 *
 * classifier ที่ล้มหรือตอบ intent ที่ไม่รู้จัก จะตกไปขั้นถัดไปเสมอ — ข้อความทุกข้อความได้คำตอบ
 *
 * | intent             | handler                  |
 * |--------------------|--------------------------|
 * | `chat`             | `ChatHandler` → AI Orchestrator |
 * | `switch_assistant` | `SwitchAssistantHandler` |
 * | `pc_command`       | `PCCommandHandler` → module `pc-bridge` (ถ้ามี) ไม่งั้นตอบ stub |
 * | `agent`            | `AgentHandler` → agentRegistry (+ เปิด Agent Panel ถ้า agent ขอ) |
 *
 * classifier และ handler ทุกตัวฉีดผ่าน constructor ได้ (ใช้ใน test)
 *
 * @see ../../../../docs/ARCHITECTURE.md — หัวข้อ 5 Intent Router
 * @see ../../../../docs/DECISIONS.md — ADR-005, ADR-006
 */

import { AgentClassifier } from '../classifiers/AgentClassifier';
import { JevClassifier } from '../classifiers/JevClassifier';
import { LLMClassifier } from '../classifiers/LLMClassifier';
import { RuleClassifier } from '../classifiers/RuleClassifier';
import { AgentHandler } from '../handlers/AgentHandler';
import { ChatHandler } from '../handlers/ChatHandler';
import { PCCommandHandler } from '../handlers/PCCommandHandler';
import { SwitchAssistantHandler } from '../handlers/SwitchAssistantHandler';
import type {
  Classifier,
  HandlerResult,
  IntentHandlers,
  RouterInput,
  RouterOutput,
} from './types';

/** Jev answers below this confidence defer to the LLM classifier (0.7 itself is accepted). */
export const JEV_MIN_CONFIDENCE = 0.7;

/** Used when every classifier is unavailable: treat the message as plain chat. */
const DEFAULT_ROUTE: RouterOutput = { intent: 'chat', confidence: 0.5, provider: 'rule' };

interface IntentRouterDeps {
  rule?: RuleClassifier;
  agent?: Classifier;
  jev?: Classifier;
  llm?: Classifier;
  handlers?: Partial<IntentHandlers>;
}

/**
 * rule (regex, free) → agent (registered patterns, free) → Jev (if enabled, confidence ≥ 0.7) → LLM → default chat.
 * Classifier failures never block the user: they fall through to the next stage.
 */
export class IntentRouter {
  private readonly rule: RuleClassifier;
  private readonly agent: Classifier;
  private readonly jev: Classifier;
  private readonly llm: Classifier;
  private readonly handlers: IntentHandlers;

  constructor(deps: IntentRouterDeps = {}) {
    this.rule = deps.rule ?? new RuleClassifier();
    this.agent = deps.agent ?? new AgentClassifier();
    this.jev = deps.jev ?? new JevClassifier();
    this.llm = deps.llm ?? new LLMClassifier();
    this.handlers = {
      chat: new ChatHandler(),
      pc_command: new PCCommandHandler(),
      switch_assistant: new SwitchAssistantHandler(),
      agent: new AgentHandler(),
      ...deps.handlers,
    };
  }

  async route(input: RouterInput): Promise<RouterOutput> {
    const text = input.text.trim();
    if (!text) return DEFAULT_ROUTE;

    const byRule = this.rule.check(text);
    if (byRule) return byRule;

    // ก่อน Jev/LLM: pattern ของ agent ฟรีและแม่นกว่าให้ model เดา — และ model บอกไม่ได้ว่า agent ตัวไหน
    const byAgent = await this.agent.classify(input).catch(() => null);
    if (byAgent) return byAgent;

    const byJev = await this.jev.classify(input).catch(() => null);
    if (byJev && byJev.confidence >= JEV_MIN_CONFIDENCE) return byJev;

    const byLLM = await this.llm.classify(input).catch(() => null);
    return byLLM ?? DEFAULT_ROUTE;
  }

  /** route() then run the matching handler. */
  async handle(input: RouterInput): Promise<{ route: RouterOutput; result: HandlerResult }> {
    const route = await this.route(input);
    return { route, result: await this.dispatch(input, route) };
  }

  /** Exhaustive switch: each handler receives exactly its own route variant. */
  private dispatch(input: RouterInput, route: RouterOutput): Promise<HandlerResult> {
    switch (route.intent) {
      case 'chat':
        return this.handlers.chat.handle(input, route);
      case 'pc_command':
        return this.handlers.pc_command.handle(input, route);
      case 'switch_assistant':
        return this.handlers.switch_assistant.handle(input, route);
      case 'agent':
        return this.handlers.agent.handle(input, route);
    }
  }
}
