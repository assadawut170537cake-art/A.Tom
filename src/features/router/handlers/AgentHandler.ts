import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import { redactSecrets } from '../../../core/http/errors';
import { DEFAULT_PERSONA } from '../../../core/types/persona';
import type { HandlerResult, IntentHandler, RouteOf, RouterInput } from '../core/types';

/** ข้อความเมื่อ route ชี้ไป agent ที่ไม่มีแล้ว (เช่น ถูกถอดออกระหว่างทาง) */
export const AGENT_NOT_FOUND_REPLY = 'ไม่พบผู้ช่วยสำหรับคำสั่งนี้ครับ — ลองพิมพ์ใหม่อีกครั้ง';

/**
 * รัน agent ตาม route แล้วคืนคำตอบ + `agentScreen` เมื่อ agent ขอเปิด UI (และมีหน้าจอจริง)
 *
 * agent ล้ม → **ตอบเป็นข้อความไทย** (ไม่ throw) เพราะไม่ใช่ปัญหาเครือข่าย/API key —
 * ถ้า throw, conversation จะแสดงคำแนะนำแบบ provider (เช่น "ตรวจการเชื่อมต่อ") ซึ่งชี้ผิดทาง
 */
export class AgentHandler implements IntentHandler<'agent'> {
  constructor(private readonly registry: AgentRegistry = agentRegistry) {}

  async handle(input: RouterInput, route: RouteOf<'agent'>): Promise<HandlerResult> {
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;
    const { agentId, commandText, capabilityId } = route.entities;
    const agent = this.registry.getAgent(agentId);
    if (!agent) return { reply: AGENT_NOT_FOUND_REPLY, persona };

    try {
      const result = await this.registry.run(agentId, { text: input.text, commandText, capabilityId, persona });
      return {
        reply: result.reply,
        persona,
        ...(result.showScreen && agent.hasScreen ? { agentScreen: { agentId } } : {}),
        ...(result.imageUri ? { imageUri: result.imageUri } : {}),
        ...(result.visualCard ? { visualCard: result.visualCard } : {}),
      };
    } catch (e) {
      const reason = redactSecrets(e instanceof Error ? e.message : String(e));
      return { reply: `${agent.name}ทำงานไม่สำเร็จครับ — ${reason}`, persona };
    }
  }
}
