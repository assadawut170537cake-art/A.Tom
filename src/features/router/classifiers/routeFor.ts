import type { Intent, RouteSource, RouterOutput } from '../core/types';
import { findPersona } from './RuleClassifier';

/**
 * Build the route for an intent decided by a model (Jev / LLM). Models only label the intent,
 * so the switch target is taken from the text itself; other intents carry no entities.
 */
export function routeFor(
  intent: Intent,
  confidence: number,
  provider: RouteSource,
  text: string
): RouterOutput {
  switch (intent) {
    case 'chat':
    case 'pc_command':
      return { intent, confidence, provider };
    case 'switch_assistant': {
      const persona = findPersona(text);
      return persona
        ? { intent, confidence, provider, entities: { persona: `${persona}` } }
        : { intent, confidence, provider };
    }
  }
}
