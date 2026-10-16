import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import type { AgentCapability } from '../../../core/agents/types';
import type { Classifier, RouterInput, RouterOutput } from '../core/types';

/** pattern ของ agent เขียนมาเฉพาะเจาะจงแล้ว — มั่นใจพอ ๆ กับ RuleClassifier */
export const AGENT_CONFIDENCE = 0.9;

/** เนื้อคำสั่ง: named group `command` ถ้ามี ไม่งั้นข้อความที่เหลือหลังตัดส่วนที่ match ออก */
function commandTextOf(text: string, match: RegExpMatchArray): string {
  const named = match.groups?.command;
  if (named !== undefined) return named.trim();
  const start = match.index ?? 0;
  return (text.slice(0, start) + text.slice(start + match[0].length)).trim();
}

function matchCapability(text: string, capability: AgentCapability): string | null {
  for (const pattern of capability.patterns) {
    // pattern แบบ /g หรือ /y จำ lastIndex ข้ามรอบ — clone เป็นแบบไม่มี state ก่อนใช้
    const safe = pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern;
    const match = text.match(safe);
    if (match) return commandTextOf(text, match);
  }
  return null;
}

/**
 * จับคู่ข้อความกับ capability ของ agent ที่ลงทะเบียนใน agentRegistry (regex, ฟรี, ออฟไลน์ได้)
 * ตัวแรกที่ match ชนะ (ลำดับลงทะเบียน) · ไม่ match / ไม่มี agent → null ให้ Jev / LLM ตัดสินต่อ
 */
export class AgentClassifier implements Classifier {
  constructor(private readonly registry: AgentRegistry = agentRegistry) {}

  async classify({ text }: RouterInput): Promise<RouterOutput | null> {
    return this.check(text);
  }

  check(raw: string): RouterOutput | null {
    const text = raw.trim();
    if (!text) return null;
    for (const { agentId, capability } of this.registry.listCapabilities()) {
      const commandText = matchCapability(text, capability);
      if (commandText !== null) {
        return {
          intent: 'agent',
          confidence: AGENT_CONFIDENCE,
          provider: 'agent',
          entities: { agentId, commandText, capabilityId: capability.id },
        };
      }
    }
    return null;
  }
}
