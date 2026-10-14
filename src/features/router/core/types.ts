import type { ChatMessage } from '../../ai/core/types';
import type { Persona } from '../../jarvis/types';

export type Intent = 'chat' | 'pc_command' | 'switch_assistant';

export const INTENTS: readonly Intent[] = ['chat', 'pc_command', 'switch_assistant'];

export interface RouterInput {
  text: string;
  context?: {
    activePersona?: 1 | 2 | 3 | 4;
    recentMessages?: string[];
    /** Full role-tagged history for the active persona, used by ChatHandler. */
    history?: ChatMessage[];
  };
}

export interface RouterOutput {
  intent: Intent;
  confidence: number;
  entities?: Record<string, string>;
  provider: 'rule' | 'jev' | 'llm';
}

export interface Classifier {
  /** null = no opinion (let the next classifier decide). */
  classify(input: RouterInput): Promise<RouterOutput | null>;
}

export interface HandlerResult {
  /** Text to show (and speak) as the assistant's reply. */
  reply: string;
  /** Persona that should own the reply (differs from the input persona after a switch). */
  persona: Persona;
}

export interface IntentHandler {
  handle(input: RouterInput, route: RouterOutput): Promise<HandlerResult>;
}
