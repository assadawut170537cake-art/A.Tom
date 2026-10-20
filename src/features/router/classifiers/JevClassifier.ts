import {
  ProviderSettings,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import { isOneOf } from '../../../core/types/guards';
import { JevAdapter } from '../../ai/adapters/JevAdapter';
import { aiRegistry, type ProviderRegistry } from '../../ai/core/ProviderRegistry';
import {
  MODEL_INTENTS,
  type Classifier,
  type ModelIntent,
  type RouterInput,
  type RouterOutput,
} from '../core/types';
import { routeFor } from './routeFor';

// 'agent' ไม่อยู่ในนี้: Jev บอกไม่ได้ว่าเป็น agent ตัวไหน — AgentClassifier ทำหน้าที่นั้นก่อนถึง Jev
const CRITERIA: Record<ModelIntent, string> = {
  chat: 'General conversation, questions, or anything that is not a device command or assistant switch.',
  pc_command:
    "A command to control the user's computer (open/close apps, shut down, run something).",
  switch_assistant:
    'A request to switch to or call another assistant persona: ATOM (อะตอม), JARVIS (จาร์วิส), FRIDAY (ไฟรเดย์), ULTRON (อัลตรอน).',
};

/**
 * Jev อยู่หน้าทุกข้อความ → ต้องตัดเร็ว (เดิมใช้ timeout รวม 30s — เน็ตมือถือแกว่งแล้วแชทค้างทั้งข้อความ)
 * เกินเวลา = โยน timeout → router ตกไปขั้นถัดไป (ตัวกรองคำ / LLM / chat) เอง · Gemini review PR #27
 */
export const JEV_TIMEOUT_MS = 2_500;

/** Jev (TypeSafe System One) choice question → intent + confidence. Skipped when Jev is off. */
export class JevClassifier implements Classifier {
  constructor(
    private readonly registry: ProviderRegistry = aiRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings,
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
      model,
      JEV_TIMEOUT_MS,
    );

    const answer = answers.intent;
    if (answer?.type !== 'choice' || !isOneOf(MODEL_INTENTS, answer.choice)) return null;
    const intent = answer.choice;
    const confidence = answer.confidence ?? answer.probabilities?.[intent] ?? 0;
    return routeFor(intent, confidence, 'jev', input.text);
  }
}
