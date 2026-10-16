// src/features/router/handlers/AgentHandler.ts

import { agentBroker } from '../../../core/agents/AgentBroker';
import { DEFAULT_PERSONA } from '../../../core/types/persona';
import type { HandlerResult, IntentHandler, RouteOf, RouterInput } from '../core/types';

/**
 * AgentHandler — รับ route intent 'agent' แล้วสั่งงานผ่าน AgentBroker (sandbox + timeout)
 *
 * ถ้า agent คืน shouldNavigate: true HandlerResult จะติด agentScreen ไว้
 * เพื่อให้ MainScreen รู้ว่าต้องเปิดหน้า UI ของเอเจนนั้นภายใน AgentErrorBoundary
 */
export class AgentHandler implements IntentHandler<'agent'> {
  async handle(
    input: RouterInput,
    route: RouteOf<'agent'>
  ): Promise<HandlerResult> {
    const agentId = route.entities?.agentId;
    const commandText = route.entities?.commandText ?? input.text;
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;

    if (!agentId) {
      return { reply: 'ไม่พบเอเจนที่ต้องการสั่งงานครับ', persona };
    }

    const result = await agentBroker.executeCommandSafe(agentId, commandText);

    if (result.shouldNavigate) {
      return {
        reply: result.reply,
        persona,
        agentScreen: { agentId },
      };
    }

    return { reply: result.reply, persona };
  }
}
