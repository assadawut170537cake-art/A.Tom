import { ProviderSettings, type ProviderSettingsStore } from '../../../core/storage/ProviderSettings';
import type { JevAdapter } from '../../ai/adapters/JevAdapter';
import { aiRegistry, type ProviderRegistry } from '../../ai/core/ProviderRegistry';
import { findPersona } from './RuleClassifier';
import { INTENTS, type Classifier, type Intent, type RouterInput, type RouterOutput } from '../core/types';

const CRITERIA: Record<Intent, string> = {
  chat: 'General conversation, questions, or anything that is not a device command or assistant switch.',
  pc_command: "A command to control the user's computer (open/close apps, shut down, run something).",
  switch_assistant:
    'A request to switch to or call another assistant persona: ATOM (อะตอม), JARVIS (จาร์วิส), FRIDAY (ไฟรเดย์), ULTRON (อัลตรอน).',
};

/** Jev (TypeSafe System One) choice question → intent + confidence. Skipped when Jev is off. */
export class JevClassifier implements Classifier {
  constructor(
    private readonly registry: ProviderRegistry = aiRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings
  ) {}

  async isEnabled(): Promise<boolean> {
    const jev = this.registry.get('jev');
    if (!jev) return false;
    return (await this.settings.getEnabled('jev')) ?? jev.config.enabled;
  }

  async classify(input: RouterInput): Promise<RouterOutput | null> {
    if (!(await this.isEnabled())) return null;
    const jev = this.registry.get('jev') as JevAdapter;
    const model = (await this.settings.getModelFor('jev')) ?? jev.config.defaultModel;

    const state = {
      message: input.text,
      ...(input.context?.recentMessages?.length && {
        recent_messages: input.context.recentMessages.slice(-5),
      }),
    };
    const { answers } = await jev.ask(
      state,
      {
        intent: {
          type: 'choice',
          instructions: 'What does the user want the assistant to do with this message?',
          criteria: CRITERIA,
        },
      },
      model
    );

    const answer = answers.intent;
    if (answer?.type !== 'choice' || !INTENTS.includes(answer.choice as Intent)) return null;
    const intent = answer.choice as Intent;
    const persona = intent === 'switch_assistant' ? findPersona(input.text) : undefined;
    return {
      intent,
      confidence: answer.confidence ?? answer.probabilities?.[intent] ?? 0,
      ...(persona && { entities: { persona: String(persona) } }),
      provider: 'jev',
    };
  }
}
