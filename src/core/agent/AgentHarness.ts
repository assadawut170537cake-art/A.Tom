/**
 * @file Agent Harness — ควบคุม execution loop + tool dispatching
 *
 * แต่ละ step: ถาม LLM ว่าจะเรียก tool ไหน หรือพอตอบแล้ว (JSON) → ถ้าเป็น tool ก็ส่งให้ CommandModule
 * ใน ModuleRegistry (init ให้ก่อนผ่าน `ensureReady`) → ผลกลับเข้า transcript → step ถัดไป
 *
 * - Max steps guard: ครบ `maxSteps` แล้วยังไม่ได้คำตอบ → หยุด ตอบข้อความแจ้ง (`stopReason: 'max_steps'`)
 * - tool ไม่มี / ปิด / ไม่ใช่ CommandModule / execute ล้ม → ไม่ throw แต่ส่งผลล้มกลับให้ LLM ตัดสินใจต่อ
 * - LLM ล้ม → `onError` แล้ว throw ต่อ (ให้ conversation แสดง error ตามปกติ)
 * - hook ที่ throw ถูก log (console.error) ไม่ทำให้ loop ล้ม
 * - ผลของ tool ผ่าน `redactSecrets()` ก่อนกลับเข้า prompt
 * - tool มาจาก ModuleRegistry (CommandModule) ก่อน แล้วค่อย `providers` (MCP / Skill / Device)
 * - `memory`: แนบ facts (global + persona) ผ่าน `toPromptLine()` เป็น context
 */

import { redactSecrets } from '../http/errors';
import { toPromptLine } from '../memory/promptLine';
import type { MemoryStore, MemoryTarget } from '../memory/types';
import type { ModuleRegistry } from '../modules/ModuleRegistry';
import { isCommandModule } from '../modules/types';
import { isRecord, isString, parseJSON } from '../types/guards';
import type {
  AgentDecision,
  AgentHarnessOptions,
  AgentHooks,
  AgentLLM,
  AgentMessage,
  AgentRunInput,
  AgentRunResult,
  AgentStep,
  AgentToolCall,
  AgentToolProvider,
  AgentToolResult,
  AgentToolSpec,
} from './types';

export const DEFAULT_MAX_STEPS = 5;
/** facts ล่าสุดที่แนบเป็น context */
export const AGENT_MEMORY_FACTS = 10;
export const MAX_STEPS_REPLY = 'ขอโทษครับบอส ทำงานนี้เกินจำนวนขั้นที่กำหนดแล้ว — ลองสั่งให้เจาะจงขึ้นอีกนิด';

type ToolHost = Pick<ModuleRegistry, 'get' | 'isEnabled' | 'ensureReady' | 'list'>;

const errorText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e));
const optString = (v: unknown) => (isString(v) && v.trim() !== '' ? v.trim() : undefined);

/** แปลงคำตอบ LLM → decision · ไม่ใช่ JSON ที่รู้จัก = คำตอบสุดท้ายเป็นข้อความตรง ๆ */
export function parseDecision(raw: string): AgentDecision {
  const text = raw.trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  const obj = parseJSON(json, isRecord);
  if (obj) {
    const tool = optString(obj.tool);
    if (tool) {
      return {
        type: 'tool',
        tool,
        action: optString(obj.action),
        target: optString(obj.target),
        text: optString(obj.text),
        ...(isRecord(obj.args) && { args: obj.args }),
      };
    }
    const final = optString(obj.final) ?? optString(obj.reply);
    if (final) return { type: 'final', reply: final };
  }
  return { type: 'final', reply: text };
}

export class AgentHarness {
  readonly maxSteps: number;
  private readonly hooks: AgentHooks;
  private readonly providers: readonly AgentToolProvider[];
  private readonly memory: MemoryStore | undefined;

  constructor(
    private readonly llm: AgentLLM,
    private readonly tools: ToolHost,
    options: AgentHarnessOptions = {}
  ) {
    this.maxSteps = Math.max(1, Math.floor(options.maxSteps ?? DEFAULT_MAX_STEPS));
    this.hooks = options.hooks ?? {};
    this.providers = options.providers ?? [];
    this.memory = options.memory;
  }

  /** tool ที่ใช้ได้ตอนนี้ = CommandModule ที่เปิดอยู่ + tool จาก providers (id ซ้ำ → ตัวแรกชนะ) */
  availableTools(): AgentToolSpec[] {
    const modules = this.tools.list().flatMap((info): AgentToolSpec[] => {
      const module = this.tools.get(info.id);
      return info.enabled && module && isCommandModule(module)
        ? [{ id: info.id, name: info.name, description: info.description, source: 'module' }]
        : [];
    });
    const seen = new Set(modules.map((t) => t.id));
    const extra = this.providers.flatMap((p) => this.safeList(p)).filter((t) => !seen.has(t.id) && seen.add(t.id));
    return [...modules, ...extra];
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const steps: AgentStep[] = [];
    try {
      await this.emit('onStart', input);
      const messages = this.initialMessages(input, await this.memoryContext(input));
      for (let index = 0; index < this.maxSteps; index++) {
        const decision = parseDecision(await this.llm.chat(messages));
        messages.push({ role: 'assistant', content: JSON.stringify(decision) });
        const step: AgentStep = { index, decision };
        steps.push(step);

        if (decision.type === 'final') {
          await this.emit('onStep', step);
          const result: AgentRunResult = { input, reply: decision.reply, steps, stopReason: 'final' };
          await this.emit('onComplete', result);
          return result;
        }

        const call: AgentToolCall = {
          tool: decision.tool,
          action: decision.action,
          target: decision.target,
          text: decision.text ?? input.text,
          ...(decision.args && { args: decision.args }),
        };
        const toolResult = await this.dispatch(call);
        step.toolCall = call;
        step.toolResult = toolResult;
        await this.emit('onToolCall', call, toolResult);
        await this.emit('onStep', step);
        messages.push({
          role: 'user',
          content: `ผลจาก tool "${call.tool}" (${toolResult.ok ? 'สำเร็จ' : 'ล้มเหลว'}): ${toolResult.output}`,
        });
      }
      const result: AgentRunResult = { input, reply: MAX_STEPS_REPLY, steps, stopReason: 'max_steps' };
      await this.emit('onComplete', result);
      return result;
    } catch (e) {
      await this.emit('onError', e, steps);
      throw e;
    }
  }

  /** ส่งงานให้ module — ไม่ throw เด็ดขาด (ผลล้มกลับไปให้ LLM) */
  async dispatch(call: AgentToolCall): Promise<AgentToolResult> {
    const module = this.tools.get(call.tool);
    if (!module) return this.dispatchToProvider(call);
    if (!this.tools.isEnabled(call.tool)) return { ok: false, output: `tool "${call.tool}" ถูกปิดอยู่` };
    if (!isCommandModule(module)) return { ok: false, output: `"${call.tool}" ไม่ใช่ tool ที่สั่งงานได้` };
    try {
      await this.tools.ensureReady(call.tool);
      const { reply } = await module.execute({ text: call.text, action: call.action, target: call.target });
      return { ok: true, output: redactSecrets(reply) };
    } catch (e) {
      return { ok: false, output: errorText(e) };
    }
  }

  private async dispatchToProvider(call: AgentToolCall): Promise<AgentToolResult> {
    const provider = this.providers.find((p) => this.safeList(p).some((t) => t.id === call.tool));
    if (!provider) return { ok: false, output: `ไม่พบ tool "${call.tool}"` };
    try {
      const result = await provider.call(call);
      return { ok: result.ok, output: redactSecrets(result.output) };
    } catch (e) {
      return { ok: false, output: errorText(e) };
    }
  }

  /** provider ที่ list พัง → ถือว่าไม่มี tool (log) ไม่ทำให้ agent ล้ม */
  private safeList(provider: AgentToolProvider): AgentToolSpec[] {
    try {
      return provider.listTools();
    } catch (e) {
      console.error('[agent] อ่านรายการ tool ไม่ได้', e);
      return [];
    }
  }

  private async memoryContext(input: AgentRunInput): Promise<string | undefined> {
    if (!this.memory) return undefined;
    const targets: MemoryTarget[] = [{ scope: 'global' }];
    if (input.persona) targets.push({ scope: 'persona', persona: input.persona });
    try {
      const facts = (await Promise.all(targets.map((t) => this.memory?.list(t) ?? []))).flat();
      if (!facts.length) return undefined;
      const recent = facts.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_MEMORY_FACTS);
      return ['สิ่งที่จำได้เกี่ยวกับบอส:', ...recent.map((f) => `- ${toPromptLine(f.key, 64)}: ${toPromptLine(f.value)}`)].join('\n');
    } catch (e) {
      console.error('[agent] อ่าน shared memory ไม่ได้ — ทำงานต่อโดยไม่ใช้ความจำ', e);
      return undefined;
    }
  }

  private initialMessages(input: AgentRunInput, memory: string | undefined): AgentMessage[] {
    const tools = this.availableTools();
    const list = tools.length
      ? tools
          .map((t) => `- ${t.id}: ${toPromptLine(t.name, 80)}${t.description ? ` — ${toPromptLine(t.description)}` : ''}`)
          .join('\n')
      : '- (ไม่มี tool ที่เปิดใช้งาน)';
    const protocol = [
      'คุณคือ agent ของ A.T.O.M. ตอบเป็น JSON บรรทัดเดียวเท่านั้น:',
      '{"tool":"<id>","action":"...","target":"...","text":"...","args":{...}} เพื่อเรียก tool หรือ',
      '{"final":"<คำตอบถึงบอส>"} เมื่อพร้อมตอบ',
      `Tools ที่ใช้ได้:\n${list}`,
      ...(input.intent ? [`Intent: ${input.intent}`] : []),
      ...(memory ? [memory] : []),
    ].join('\n');
    return [
      { role: 'system', content: input.systemPrompt ? `${input.systemPrompt}\n\n${protocol}` : protocol },
      ...(input.history ?? []).filter((m) => m.role !== 'system'),
      { role: 'user', content: input.text },
    ];
  }

  private async emit<K extends keyof AgentHooks>(name: K, ...args: Parameters<NonNullable<AgentHooks[K]>>) {
    const hook = this.hooks[name] as ((...a: typeof args) => void | Promise<void>) | undefined; // generic tuple ของ hook นั้น
    if (!hook) return;
    try {
      await hook(...args);
    } catch (e) {
      console.error(`[agent] hook ${name} ล้ม — ทำงานต่อ`, e);
    }
  }
}
