import type { Persona } from '../../jarvis/types';
import type { Classifier, RouterInput, RouterOutput } from '../core/types';

/** Persona names (Thai + English, incl. common misspellings) → id, for findPersona(). */
const PERSONA_ALIASES: { pattern: RegExp; persona: Persona }[] = [
  { pattern: /อะตอม|atom/i, persona: 1 },
  { pattern: /จาร์วิส|จาวิส|jarvis/i, persona: 2 },
  { pattern: /ไฟรเดย์|ฟรายเดย์|friday/i, persona: 3 },
  { pattern: /อัลตรอน|ultron/i, persona: 4 },
];

const NAMES = 'อะตอม|จาร์วิส|จาวิส|ไฟรเดย์|ฟรายเดย์|อัลตรอน|atom|jarvis|friday|ultron';

/** Verb must come before the target: "เรียกจาร์วิส", "เปลี่ยนเป็นไฟรเดย์", "switch to ultron". */
const SWITCH = new RegExp(`(เรียก|เปลี่ยน|สลับ|switch|call).*(${NAMES})`, 'i');
/** "เปิดคอม", "ปิดเครื่อง", "สั่ง PC ..." */
const PC_COMMAND = /(เปิด|ปิด|สั่ง|shut ?down|restart).*(คอม|เครื่อง|pc|computer)/i;

export function findPersona(text: string): Persona | undefined {
  // Last mention wins: in "เปลี่ยนจากอะตอมเป็นจาร์วิส" the target is the later name
  let best: { persona: Persona; index: number } | undefined;
  for (const { pattern, persona } of PERSONA_ALIASES) {
    const global = new RegExp(pattern.source, 'gi');
    for (const m of text.matchAll(global)) {
      if (!best || m.index > best.index) best = { persona, index: m.index };
    }
  }
  return best?.persona;
}

/** Zero-cost regex pass; returns null for anything it doesn't recognise. */
export class RuleClassifier implements Classifier {
  async classify({ text }: RouterInput): Promise<RouterOutput | null> {
    return this.check(text);
  }

  check(text: string): RouterOutput | null {
    if (SWITCH.test(text)) {
      const persona = findPersona(text);
      if (persona) {
        return {
          intent: 'switch_assistant',
          confidence: 0.95,
          entities: { persona: String(persona) },
          provider: 'rule',
        };
      }
    }
    const pc = text.match(PC_COMMAND);
    if (pc) {
      return {
        intent: 'pc_command',
        confidence: 0.9,
        entities: { action: pc[1], target: pc[2] },
        provider: 'rule',
      };
    }
    return null;
  }
}
