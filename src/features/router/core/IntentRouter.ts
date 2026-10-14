import { JevClassifier } from '../classifiers/JevClassifier';
import { LLMClassifier } from '../classifiers/LLMClassifier';
import { RuleClassifier } from '../classifiers/RuleClassifier';
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
  jev?: Classifier;
  llm?: Classifier;
  handlers?: Partial<IntentHandlers>;
}

/**
 * rule (regex, free) → Jev (if enabled, confidence ≥ 0.7) → LLM → default chat.
 * Classifier failures never block the user: they fall through to the next stage.
 */
export class IntentRouter {
  private readonly rule: RuleClassifier;
  private readonly jev: Classifier;
  private readonly llm: Classifier;
  private readonly handlers: IntentHandlers;

  constructor(deps: IntentRouterDeps = {}) {
    this.rule = deps.rule ?? new RuleClassifier();
    this.jev = deps.jev ?? new JevClassifier();
    this.llm = deps.llm ?? new LLMClassifier();
    this.handlers = {
      chat: new ChatHandler(),
      pc_command: new PCCommandHandler(),
      switch_assistant: new SwitchAssistantHandler(),
      ...deps.handlers,
    };
  }

  async route(input: RouterInput): Promise<RouterOutput> {
    const text = input.text.trim();
    if (!text) return DEFAULT_ROUTE;

    const byRule = this.rule.check(text);
    if (byRule) return byRule;

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
    }
  }
}
