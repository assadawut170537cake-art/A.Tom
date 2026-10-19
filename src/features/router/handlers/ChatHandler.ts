import { MAX_PROMPT_LINE, toPromptLine } from '../../../core/memory/promptLine';
import type { MemoryFact, MemoryStore } from '../../../core/memory/types';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import type { AIProviderId } from '../../../core/types/aiProvider';
import { aiOrchestrator, type Orchestrator } from '../../ai/core/Orchestrator';
import type { ChatMessage } from '../../ai/core/types';
import { getPersonaPrompt } from '../../ai/prompts/personaPrompts';
import { DEFAULT_PERSONA, type Persona } from '../../../core/types/persona';
import { USER_NAME } from '../../jarvis/constants';
import type { HandlerResult, IntentHandler, RouterInput } from '../core/types';

/** Keep prompts small: the last N turns of the persona's own history. */
const MAX_HISTORY = 20;
/** Most recently updated memory facts appended to the system prompt. */
export const MAX_MEMORY_FACTS = 20;
/** ค่าของ fact ยาวสุดที่ส่งเข้า prompt — Memory UI ใช้ค่าเดียวกันเป็น maxLength */
export const MAX_FACT_LENGTH = MAX_PROMPT_LINE;

// toPromptLine ย้ายไป core (agent ก็ใช้) — re-export ไว้ให้ import จากที่เดิมได้
export { toPromptLine };

type SystemPromptFor = (persona: Persona) => string | undefined;
/** LLM ที่บอสผูกไว้กับ persona (ตั้งค่า › AI) — undefined = อัตโนมัติ */
type LLMFor = (persona: Persona) => Promise<AIProviderId | undefined>;

/**
 * Forwards the conversation to the AI Orchestrator with the active persona's system prompt.
 * With a `memoryStore`, shared facts (global + this persona's) are appended to that prompt;
 * without one — or if reading memory fails — the request is exactly as before.
 */
export class ChatHandler implements IntentHandler<'chat'> {
  constructor(
    private readonly orchestrator: Orchestrator = aiOrchestrator,
    private readonly systemPromptFor: SystemPromptFor = getPersonaPrompt,
    private readonly memoryStore?: MemoryStore,
    private readonly llmFor: LLMFor = ProviderSettings.getLLMFor
  ) {}

  async handle(input: RouterInput): Promise<HandlerResult> {
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;
    const system = [this.systemPromptFor(persona), await this.memoryNotes(persona)]
      .filter(Boolean)
      .join('\n\n');
    const messages: ChatMessage[] = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...(input.context?.history ?? []).filter((m) => m.role !== 'system').slice(-MAX_HISTORY),
      { role: 'user', content: input.text },
    ];
    // persona ที่ผูกโมเดลไว้ = ลองตัวนั้นก่อน (ล้มยัง fallback ตามลำดับ) · ไม่ผูก = อัตโนมัติเหมือนเดิม
    const providerId = await this.preferredLLM(persona);
    const res = await this.orchestrator.chat(providerId ? { messages, providerId } : { messages });
    return { reply: res.content.trim(), persona };
  }

  private async preferredLLM(persona: Persona): Promise<AIProviderId | undefined> {
    try {
      return await this.llmFor(persona);
    } catch (e) {
      console.error('[chat] อ่านโมเดลของ persona ไม่ได้ — ใช้อัตโนมัติ', e);
      return undefined;
    }
  }

  /** "What I remember about Boss" block, or '' when there is no memory (or it can't be read). */
  private async memoryNotes(persona: Persona): Promise<string> {
    if (!this.memoryStore) return '';
    let facts: MemoryFact[];
    try {
      const [shared, own] = await Promise.all([
        this.memoryStore.list({ scope: 'global' }),
        this.memoryStore.list({ scope: 'persona', persona }),
      ]);
      // A persona's own fact overrides a global one with the same key
      facts = [...new Map([...shared, ...own].map((f) => [f.key, f])).values()];
    } catch (e) {
      console.error('[chat] อ่าน shared memory ไม่ได้ — ตอบโดยไม่ใช้ความจำ', e);
      return '';
    }
    if (!facts.length) return '';
    const recent = facts.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_MEMORY_FACTS);
    // key ก็บีบด้วย: LocalMemoryAdapter ตรวจรูปแบบ key แล้ว แต่ MemoryStore ตัวอื่น (เช่น remote) อาจไม่ตรวจ
    const lines = recent.map((f) => `- ${toPromptLine(f.key, 64)}: ${toPromptLine(f.value)}`);
    return [`สิ่งที่จำได้เกี่ยวกับ${USER_NAME}:`, ...lines].join('\n');
  }
}
