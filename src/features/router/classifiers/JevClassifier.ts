import { ProviderSettings, type ProviderSettingsStore } from '../../../core/storage/ProviderSettings';
import { isOneOf } from '../../../core/types/guards';
import { JevAdapter } from '../../ai/adapters/JevAdapter';
import { aiRegistry, type ProviderRegistry } from '../../ai/core/ProviderRegistry';
import { INTENTS, type Classifier, type Intent, type RouterInput, type RouterOutput } from '../core/types';
import { routeFor } from './routeFor';

const CRITERIA: Record<Intent, string> = {
  chat: 'General conversation, questions, or anything that is not a device command or assistant switch.',
  pc_command: "A command to control the user's computer (open/close apps, shut down, run something).",
  switch_assistant:
    'A request to switch to or call another assistant persona: ATOM (อะตอม), JARVIS (จาร์วิส), FRIDAY (ไฟรเดย์), ULTRON (อัลตรอน).',
  agent: 'A request to use a specialist agent capability (e.g. create a note, send email, control PC).',
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
    const jev = this.registry.get('jev');
    if (!(jev instanceof JevAdapter)) return null;
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
    if (answer?.type !== 'choice' || !isOneOf(INTENTS, answer.choice)) return null;
    const intent = answer.choice;
    const confidence = answer.confidence ?? answer.probabilities?.[intent] ?? 0;
    return routeFor(intent, confidence, 'jev', input.text);
  }
}
