import type { ChatMessage } from '../../ai/core/types';
import type { Persona } from '../../../core/types/persona';

export const INTENTS = ['chat', 'pc_command', 'switch_assistant', 'agent'] as const;
export type Intent = (typeof INTENTS)[number];

/** Which stage decided the route. */
export type RouteSource = 'rule' | 'jev' | 'llm';

/** Persona id as carried in route entities ('1' | '2' | '3' | '4'). */
export type PersonaEntity = `${Persona}`;

export interface RouterInput {
  text: string;
  context?: {
    activePersona?: Persona;
    recentMessages?: string[];
    /** Full role-tagged history for the active persona, used by ChatHandler. */
    history?: ChatMessage[];
  };
}

interface RouteBase {
  confidence: number;
  provider: RouteSource;
}

/**
 * Discriminated on `intent`: each intent carries its own (optional) entities, so narrowing on
 * `route.intent` gives handlers typed fields instead of a free-form string map.
 */
export type RouterOutput =
  | (RouteBase & { intent: 'chat'; entities?: undefined })
  | (RouteBase & { intent: 'pc_command'; entities?: { action: string; target: string } })
  | (RouteBase & { intent: 'switch_assistant'; entities?: { persona: PersonaEntity } })
  | (RouteBase & { intent: 'agent'; entities?: { agentId: string; commandText: string } });

export type RouteOf<I extends Intent> = Extract<RouterOutput, { intent: I }>;

export interface Classifier {
  /** null = no opinion (let the next classifier decide). */
  classify(input: RouterInput): Promise<RouterOutput | null>;
}

export interface HandlerResult {
  /** Text to show (and speak) as the assistant's reply. */
  reply: string;
  /** Persona that should own the reply (differs from the input persona after a switch). */
  persona: Persona;
  /** If set, the UI should show this agent's screen (wrapped in AgentErrorBoundary). */
  agentScreen?: { agentId: string };
}

export interface IntentHandler<I extends Intent = Intent> {
  handle(input: RouterInput, route: RouteOf<I>): Promise<HandlerResult>;
}

/** One handler per intent, each receiving only its own route variant. */
export type IntentHandlers = { [I in Intent]: IntentHandler<I> };
