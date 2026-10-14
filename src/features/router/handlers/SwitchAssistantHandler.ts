import { DEFAULT_PERSONA, PERSONA_GREETINGS, PERSONAS } from '../../jarvis/constants';
import { useAtomStore } from '../../jarvis/stores/useAtomStore';
import type { Persona } from '../../jarvis/types';
import { findPersona } from '../classifiers/RuleClassifier';
import type { HandlerResult, IntentHandler, RouteOf, RouterInput } from '../core/types';

const isPersona = (n: number): n is Persona => n === 1 || n === 2 || n === 3 || n === 4;

/** Switches the active persona; the new persona answers with its greeting. */
export class SwitchAssistantHandler implements IntentHandler<'switch_assistant'> {
  constructor(
    private readonly setActivePersona: (p: Persona) => void = (p) =>
      useAtomStore.getState().setActivePersona(p)
  ) {}

  async handle(input: RouterInput, route: RouteOf<'switch_assistant'>): Promise<HandlerResult> {
    const current = input.context?.activePersona ?? DEFAULT_PERSONA;
    // Typed '1'..'4', but still validated: routes can be built by tests or future callers
    const fromEntity = Number(route.entities?.persona);
    const target = isPersona(fromEntity) ? fromEntity : findPersona(input.text);

    if (!target) {
      return { reply: 'จะให้เรียกใครครับ อะตอม จาร์วิส ไฟรเดย์ หรืออัลตรอน', persona: current };
    }
    if (target === current) {
      return { reply: `${PERSONAS[target].name}อยู่ตรงนี้แล้วครับบอส`, persona: current };
    }
    this.setActivePersona(target);
    return { reply: PERSONA_GREETINGS[target], persona: target };
  }
}
