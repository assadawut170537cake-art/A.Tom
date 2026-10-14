import { DEFAULT_PERSONA } from '../../jarvis/constants';
import type { HandlerResult, IntentHandler, RouterInput } from '../core/types';

/** Stub until the desktop bridge lands in Phase 4. */
export class PCCommandHandler implements IntentHandler {
  async handle(input: RouterInput): Promise<HandlerResult> {
    return { reply: 'Phase 4 ครับ', persona: input.context?.activePersona ?? DEFAULT_PERSONA };
  }
}
