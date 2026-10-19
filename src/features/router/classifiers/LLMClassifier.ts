import { isOneOf, isRecord, parseJSON } from '../../../core/types/guards';
import { aiOrchestrator, type Orchestrator } from '../../ai/core/Orchestrator';
import { MODEL_INTENTS, type Classifier, type ModelIntent, type RouterInput, type RouterOutput } from '../core/types';
import { routeFor } from './routeFor';

export const CLASSIFIER_SYSTEM_PROMPT =
  'Classify the user message into exactly one of: chat, pc_command, switch_assistant. ' +
  'Reply with JSON: {intent, confidence}';

/**
 * คำที่ส่อว่าอาจเป็นคำสั่ง (pc_command / switch_assistant) — ไม่มีสักคำ = คุยธรรมดา ไม่ต้องเสีย request ถามโมเดล
 * (เดิมทุกข้อความเรียก LLM 2 ครั้ง: แยกประเภท + ตอบ → โควต้าหมดเร็วเท่าตัว · Boss อนุมัติ ADR-017)
 * กว้างกว่า RuleClassifier ตั้งใจ: ประโยคแนว "เช็กเครื่องหน่อย" / "ขอคุยกับไฟรเดย์" ยังได้ให้โมเดลตัดสิน
 */
export const COMMAND_HINT =
  /คอม|เครื่อง|\bpc\b|computer|สั่ง|สลับ|เปลี่ยน|เรียก|ขอคุย|ส่งต่อ|shut ?down|restart|switch|อะตอม|จาร์วิส|จาวิส|ไฟรเดย์|ฟรายเดย์|อัลตรอน|atom|jarvis|friday|ultron/i;

/** Extracts the first JSON object from a reply that may be wrapped in prose or ``` fences. */
export function parseClassification(text: string): { intent: ModelIntent; confidence: number } | null {
  const match = text.match(/\{[\s\S]*?\}/);
  const data = parseJSON(match?.[0], isRecord);
  if (!data) return null;
  const intent = String(data.intent ?? '').trim();
  if (!isOneOf(MODEL_INTENTS, intent)) return null;
  const raw = Number(data.confidence);
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)) : 0.5;
  return { intent, confidence };
}

/** Last-resort classifier: asks the chat LLM chain (Gemini/OpenRouter) for a JSON label. */
export class LLMClassifier implements Classifier {
  constructor(
    private readonly orchestrator: Orchestrator = aiOrchestrator,
    /** false = ถามโมเดลทุกข้อความ (พฤติกรรมเดิม — test บางตัวใช้) */
    private readonly onlyWhenHinted = true
  ) {}

  async classify(input: RouterInput): Promise<RouterOutput | null> {
    // null = router ตกไป chat ตามค่าเริ่มต้น (ไม่เรียก AI)
    if (this.onlyWhenHinted && !COMMAND_HINT.test(input.text)) return null;
    const res = await this.orchestrator.chat({
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: input.text },
      ],
      temperature: 0,
      maxTokens: 50,
    });
    const parsed = parseClassification(res.content);
    return parsed && routeFor(parsed.intent, parsed.confidence, 'llm', input.text);
  }
}
