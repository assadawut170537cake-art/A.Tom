import { aiOrchestrator, type Orchestrator } from '../../ai/core/Orchestrator';
import type { ChatMessage } from '../../ai/core/types';
import { getPersonaPrompt } from '../../ai/prompts/personaPrompts';
import { DEFAULT_PERSONA } from '../../jarvis/constants';
import type { Persona } from '../../jarvis/types';
import type { HandlerResult, IntentHandler, RouterInput } from '../core/types';

/** Keep prompts small: the last N turns of the persona's own history. */
const MAX_HISTORY = 20;

type SystemPromptFor = (persona: Persona) => string | undefined;

/** Forwards the conversation to the AI Orchestrator with the active persona's system prompt. */
export class ChatHandler implements IntentHandler<'chat'> {
  constructor(
    private readonly orchestrator: Orchestrator = aiOrchestrator,
    private readonly systemPromptFor: SystemPromptFor = getPersonaPrompt
  ) {}

  async handle(input: RouterInput): Promise<HandlerResult> {
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;
    const system = this.systemPromptFor(persona);
    const messages: ChatMessage[] = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...(input.context?.history ?? []).filter((m) => m.role !== 'system').slice(-MAX_HISTORY),
      { role: 'user', content: input.text },
    ];
    const res = await this.orchestrator.chat({ messages });
    return { reply: res.content.trim(), persona };
  }
}
