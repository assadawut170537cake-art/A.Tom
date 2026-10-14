import { aiOrchestrator, type Orchestrator } from '../../ai/core/Orchestrator';
import { findPersona } from './RuleClassifier';
import { INTENTS, type Classifier, type Intent, type RouterInput, type RouterOutput } from '../core/types';

export const CLASSIFIER_SYSTEM_PROMPT =
  'Classify the user message into exactly one of: chat, pc_command, switch_assistant. ' +
  'Reply with JSON: {intent, confidence}';

/** Extracts the first JSON object from a reply that may be wrapped in prose or ``` fences. */
export function parseClassification(text: string): { intent: Intent; confidence: number } | null {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { intent?: unknown; confidence?: unknown };
    const intent = String(data.intent ?? '').trim() as Intent;
    if (!INTENTS.includes(intent)) return null;
    const raw = Number(data.confidence);
    const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)) : 0.5;
    return { intent, confidence };
  } catch {
    return null;
  }
}

/** Last-resort classifier: asks the chat LLM chain (Gemini/OpenRouter) for a JSON label. */
export class LLMClassifier implements Classifier {
  constructor(private readonly orchestrator: Orchestrator = aiOrchestrator) {}

  async classify(input: RouterInput): Promise<RouterOutput | null> {
    const res = await this.orchestrator.chat({
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: input.text },
      ],
      temperature: 0,
      maxTokens: 50,
    });
    const parsed = parseClassification(res.content);
    if (!parsed) return null;
    const persona = parsed.intent === 'switch_assistant' ? findPersona(input.text) : undefined;
    return {
      ...parsed,
      ...(persona && { entities: { persona: String(persona) } }),
      provider: 'llm',
    };
  }
}
