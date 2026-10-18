import { MAX_PROMPT_LINE, toPromptLine } from '../../../core/memory/promptLine';
import { MEMORY_SUGGESTION_INSTRUCTION, extractMemorySuggestions } from '../../../core/memory/suggestions';
import type { MemoryFact, MemoryStore } from '../../../core/memory/types';
import type { ChatToolAgent } from '../../ai/agent';
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

/**
 * Forwards the conversation to the AI Orchestrator with the active persona's system prompt.
 * With a `memoryStore`, shared facts (global + this persona's) are appended to that prompt;
 * without one — or if reading memory fails — the request is exactly as before.
 *
 * มี `memoryStore` → สอน AI ให้เสนอความจำ (`[[จำ: key=value]]`) — ถูกตัดออกจากคำตอบแล้วส่งเป็น
 * `memorySuggestions` ให้บอสกดยืนยัน · มี `toolAgent` และบอสเปิด tool ไว้ → ตอบผ่าน AgentHarness
 * (เรียก MCP / ทักษะ / ควบคุมเครื่องได้) · agent ล้ม → กลับมาแชทแบบปกติ
 */
export class ChatHandler implements IntentHandler<'chat'> {
  constructor(
    private readonly orchestrator: Orchestrator = aiOrchestrator,
    private readonly systemPromptFor: SystemPromptFor = getPersonaPrompt,
    private readonly memoryStore?: MemoryStore,
    private readonly toolAgent?: ChatToolAgent
  ) {}

  async handle(input: RouterInput): Promise<HandlerResult> {
    const persona = input.context?.activePersona ?? DEFAULT_PERSONA;
    const facts = await this.loadFacts(persona);
    const instruction = this.memoryStore ? MEMORY_SUGGESTION_INSTRUCTION : '';
    const history = (input.context?.history ?? []).filter((m) => m.role !== 'system').slice(-MAX_HISTORY);

    const viaAgent = input.attachments?.length ? null : await this.runToolAgent(input, persona, instruction, history);
    let raw: string;
    if (viaAgent !== null) {
      raw = viaAgent;
    } else {
      const system = [this.systemPromptFor(persona), formatFacts(facts), instruction].filter(Boolean).join('\n\n');
      const messages: ChatMessage[] = [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...history,
        { role: 'user', content: input.text, ...(input.attachments?.length && { attachments: input.attachments }) },
      ];
      // แชทเท่านั้นที่ค้นเว็บ/ไหล — classifier และ agent เรียก Orchestrator แบบปกติ
      const res = await this.orchestrator.chat({ messages, webSearch: true, onText: input.context?.onPartial });
      raw = res.content;
    }

    if (!this.memoryStore) return { reply: raw.trim(), persona };
    const { text, suggestions } = extractMemorySuggestions(raw);
    // เรื่องที่จำไว้แล้ว (ค่าเดิม) ไม่ต้องถามซ้ำ
    const known = new Map(facts.map((f) => [f.key, f.value]));
    const fresh = suggestions.filter((sug) => known.get(sug.key) !== sug.value);
    return fresh.length ? { reply: text, persona, memorySuggestions: fresh } : { reply: text, persona };
  }

  /** null = ไม่ใช้ agent (ไม่มี tool / agent ล้ม) → แชทปกติ */
  private async runToolAgent(
    input: RouterInput,
    persona: Persona,
    instruction: string,
    history: ChatMessage[]
  ): Promise<string | null> {
    if (!this.toolAgent) return null;
    try {
      if (!(await this.toolAgent.hasTools())) return null;
      // memory facts: harness แนบเอง (createAppAgent ส่ง localMemory ให้แล้ว)
      const systemPrompt = [this.systemPromptFor(persona), instruction].filter(Boolean).join('\n\n');
      return await this.toolAgent.run({
        text: input.text,
        persona,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        ...(systemPrompt && { systemPrompt }),
      });
    } catch (e) {
      console.error('[chat] agent ใช้ tool ไม่สำเร็จ — ตอบแบบแชทปกติแทน', e);
      return null;
    }
  }

  /** facts ของ persona นี้ (global + ของตัวเอง ทับ global ที่ key ซ้ำ) — อ่านไม่ได้ = [] */
  private async loadFacts(persona: Persona): Promise<MemoryFact[]> {
    if (!this.memoryStore) return [];
    try {
      const [shared, own] = await Promise.all([
        this.memoryStore.list({ scope: 'global' }),
        this.memoryStore.list({ scope: 'persona', persona }),
      ]);
      // A persona's own fact overrides a global one with the same key
      return [...new Map([...shared, ...own].map((f) => [f.key, f])).values()];
    } catch (e) {
      console.error('[chat] อ่าน shared memory ไม่ได้ — ตอบโดยไม่ใช้ความจำ', e);
      return [];
    }
  }
}

/** "What I remember about Boss" block, or '' when there is no memory. */
function formatFacts(facts: MemoryFact[]): string {
  if (!facts.length) return '';
  const recent = [...facts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_MEMORY_FACTS);
  // key ก็บีบด้วย: LocalMemoryAdapter ตรวจรูปแบบ key แล้ว แต่ MemoryStore ตัวอื่น (เช่น remote) อาจไม่ตรวจ
  const lines = recent.map((f) => `- ${toPromptLine(f.key, 64)}: ${toPromptLine(f.value)}`);
  return [`สิ่งที่จำได้เกี่ยวกับ${USER_NAME}:`, ...lines].join('\n');
}
