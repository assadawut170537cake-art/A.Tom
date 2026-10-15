import { AgentHarness, DEFAULT_MAX_STEPS, MAX_STEPS_REPLY, parseDecision } from '../core/agent/AgentHarness';
import type { AgentHooks, AgentLLM, AgentMessage } from '../core/agent/types';
import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import { ModuleRegistry } from '../core/modules/ModuleRegistry';
import type { AtomModule, CommandModule } from '../core/modules/types';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { createAppAgent, orchestratorLLM } from '../features/ai/agent';
import { GEMINI, geminiText, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, setAIKeys } from '../test-utils/setup';

beforeAll(registerAll);
afterEach(() => jest.restoreAllMocks());

/** LLM ที่ตอบตามสคริปต์ทีละ step และเก็บ messages ที่ได้รับ */
function scriptedLLM(...replies: (string | Error)[]): AgentLLM & { seen: AgentMessage[][] } {
  const seen: AgentMessage[][] = [];
  let i = 0;
  return {
    seen,
    chat: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const r = replies[Math.min(i++, replies.length - 1)] ?? '';
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

function tool(id: string, execute: CommandModule['execute'], opts: { enabled?: boolean } = {}) {
  const m: CommandModule & { init: jest.Mock } = {
    id,
    name: `Tool ${id}`,
    description: `ทำ ${id}`,
    enabled: opts.enabled ?? true,
    init: jest.fn(),
    dispose: jest.fn(),
    execute: jest.fn(execute),
  };
  return m;
}

function registryWith(...modules: AtomModule[]) {
  const registry = new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } });
  modules.forEach((m) => registry.register(m));
  return registry;
}

describe('parseDecision', () => {
  test.each([
    ['{"tool":"pc","action":"ปิด","target":"คอม"}', { type: 'tool', tool: 'pc', action: 'ปิด', target: 'คอม', text: undefined }],
    ['```json\n{"final":"เสร็จแล้วครับ"}\n```', { type: 'final', reply: 'เสร็จแล้วครับ' }],
    ['{"reply":"ok"}', { type: 'final', reply: 'ok' }],
    ['ตอบเป็นข้อความธรรมดา', { type: 'final', reply: 'ตอบเป็นข้อความธรรมดา' }],
    ['{"tool":"  "}', { type: 'final', reply: '{"tool":"  "}' }],
    ['{broken json', { type: 'final', reply: '{broken json' }],
  ])('%s', (raw, expected) => {
    expect(parseDecision(raw)).toEqual(expected);
  });
});

describe('AgentHarness — execution loop', () => {
  test('intent → tool call → observation → final answer', async () => {
    const pc = tool('pc', async (cmd) => ({ reply: `ปิด${cmd.target ?? ''}แล้ว` }));
    const llm = scriptedLLM('{"tool":"pc","action":"ปิด","target":"คอม"}', '{"final":"ปิดคอมให้แล้วครับบอส"}');
    const harness = new AgentHarness(llm, registryWith(pc));

    const result = await harness.run({ text: 'ปิดคอมหน่อย', intent: 'pc_command', systemPrompt: 'PERSONA' });

    expect(result.reply).toBe('ปิดคอมให้แล้วครับบอส');
    expect(result.stopReason).toBe('final');
    expect(result.steps).toHaveLength(2);
    expect(nth(result.steps, 0).toolResult).toEqual({ ok: true, output: 'ปิดคอมแล้ว' });
    expect(pc.init).toHaveBeenCalledTimes(1); // ensureReady before execute
    expect(pc.execute).toHaveBeenCalledWith({ text: 'ปิดคอมหน่อย', action: 'ปิด', target: 'คอม' });

    const [system, user] = nth(llm.seen, 0);
    expect(system?.content).toMatch(/^PERSONA\n\n/);
    expect(system?.content).toContain('- pc: Tool pc — ทำ pc');
    expect(system?.content).toContain('Intent: pc_command');
    expect(user).toEqual({ role: 'user', content: 'ปิดคอมหน่อย' });
    expect(nth(llm.seen, 1).at(-1)?.content).toBe('ผลจาก tool "pc" (สำเร็จ): ปิดคอมแล้ว');
  });

  test('direct answer with no tools: one step, "no tools" listed', async () => {
    const llm = scriptedLLM('สวัสดีครับ');
    const result = await new AgentHarness(llm, registryWith()).run({ text: 'สวัสดี' });
    expect(result).toMatchObject({ reply: 'สวัสดีครับ', stopReason: 'final' });
    expect(nth(nth(llm.seen, 0), 0).content).toContain('(ไม่มี tool ที่เปิดใช้งาน)');
    expect(nth(nth(llm.seen, 0), 0).content).not.toContain('Intent:');
  });

  test(`max steps guard (default ${DEFAULT_MAX_STEPS}) stops an endless tool loop`, async () => {
    const pc = tool('pc', async () => ({ reply: 'ยังไม่เสร็จ' }));
    const llm = scriptedLLM('{"tool":"pc"}');
    const harness = new AgentHarness(llm, registryWith(pc));
    expect(harness.maxSteps).toBe(DEFAULT_MAX_STEPS);
    const result = await harness.run({ text: 'วนไป' });
    expect(result).toMatchObject({ reply: MAX_STEPS_REPLY, stopReason: 'max_steps' });
    expect(result.steps).toHaveLength(DEFAULT_MAX_STEPS);
    expect(pc.execute).toHaveBeenCalledTimes(DEFAULT_MAX_STEPS);
  });

  test('custom maxSteps; invalid values clamp to at least 1', async () => {
    const llm = scriptedLLM('{"tool":"ghost"}');
    const result = await new AgentHarness(llm, registryWith(), { maxSteps: 2 }).run({ text: 'x' });
    expect(result.steps).toHaveLength(2);
    expect(new AgentHarness(llm, registryWith(), { maxSteps: 0 }).maxSteps).toBe(1);
    expect(new AgentHarness(llm, registryWith(), { maxSteps: 3.7 }).maxSteps).toBe(3);
  });
});

describe('AgentHarness — tool dispatching', () => {
  test('missing / disabled / non-command / failing tools return errors to the LLM (never throw)', async () => {
    const plain: AtomModule = { id: 'plain', name: 'Plain', enabled: true, init: jest.fn(), dispose: jest.fn() };
    const off = tool('off', async () => ({ reply: 'x' }), { enabled: false });
    const boom = tool('boom', async () => Promise.reject(new Error('key sk-secret123 rejected')));
    const harness = new AgentHarness(scriptedLLM(''), registryWith(plain, off, boom));

    await expect(harness.dispatch({ tool: 'ghost', text: 'x' })).resolves.toEqual({ ok: false, output: 'ไม่พบ tool "ghost"' });
    await expect(harness.dispatch({ tool: 'off', text: 'x' })).resolves.toEqual({ ok: false, output: 'tool "off" ถูกปิดอยู่' });
    await expect(harness.dispatch({ tool: 'plain', text: 'x' })).resolves.toEqual({
      ok: false,
      output: '"plain" ไม่ใช่ tool ที่สั่งงานได้',
    });
    await expect(harness.dispatch({ tool: 'boom', text: 'x' })).resolves.toEqual({
      ok: false,
      output: 'key [REDACTED] rejected',
    });
    expect(harness.availableTools().map((t) => t.id)).toEqual(['boom']);
  });

  test('init failure is reported as a tool error; the LLM can still answer', async () => {
    const pc = tool('pc', async () => ({ reply: 'x' }));
    pc.init.mockRejectedValue(new Error('no pairing'));
    const llm = scriptedLLM('{"tool":"pc"}', '{"final":"เชื่อมคอมไม่ได้ครับ"}');
    const result = await new AgentHarness(llm, registryWith(pc)).run({ text: 'เปิดคอม' });
    expect(nth(result.steps, 0).toolResult).toEqual({ ok: false, output: 'no pairing' });
    expect(result.reply).toBe('เชื่อมคอมไม่ได้ครับ');
    expect(pc.execute).not.toHaveBeenCalled();
  });

  test('tool output is redacted before it goes back into the prompt', async () => {
    const leaky = tool('leaky', async () => ({ reply: 'token AIzaLEAK999' }));
    const llm = scriptedLLM('{"tool":"leaky","text":"ขอ token"}', '{"final":"ok"}');
    await new AgentHarness(llm, registryWith(leaky)).run({ text: 'x' });
    expect(leaky.execute).toHaveBeenCalledWith({ text: 'ขอ token', action: undefined, target: undefined });
    expect(nth(llm.seen, 1).at(-1)?.content).toBe('ผลจาก tool "leaky" (สำเร็จ): token [REDACTED]');
  });
});

describe('AgentHarness — lifecycle hooks', () => {
  test('onStart → onToolCall → onStep… → onComplete, in order', async () => {
    const order: string[] = [];
    const hooks: AgentHooks = {
      onStart: (input) => void order.push(`start:${input.text}`),
      onStep: (step) => void order.push(`step:${step.index}:${step.decision.type}`),
      onToolCall: (call, res) => void order.push(`tool:${call.tool}:${res.ok}`),
      onComplete: (r) => void order.push(`complete:${r.stopReason}`),
      onError: () => void order.push('error'),
    };
    const pc = tool('pc', async () => ({ reply: 'done' }));
    await new AgentHarness(scriptedLLM('{"tool":"pc"}', '{"final":"ok"}'), registryWith(pc), { hooks }).run({ text: 'go' });
    expect(order).toEqual(['start:go', 'tool:pc:true', 'step:0:tool', 'step:1:final', 'complete:final']);
  });

  test('LLM failure → onError with the steps so far, then rethrown', async () => {
    const onError = jest.fn();
    const onComplete = jest.fn();
    const pc = tool('pc', async () => ({ reply: 'done' }));
    const harness = new AgentHarness(scriptedLLM('{"tool":"pc"}', new Error('all providers down')), registryWith(pc), {
      hooks: { onError, onComplete },
    });
    await expect(harness.run({ text: 'x' })).rejects.toThrow('all providers down');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), [expect.objectContaining({ index: 0 })]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('max_steps also completes through onComplete', async () => {
    const onComplete = jest.fn();
    await new AgentHarness(scriptedLLM('{"tool":"x"}'), registryWith(), { maxSteps: 1, hooks: { onComplete } }).run({
      text: 'x',
    });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ stopReason: 'max_steps' }));
  });

  test('a throwing hook is logged and never breaks the loop', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const hooks: AgentHooks = {
      onStart: () => {
        throw new Error('hook bug');
      },
      onStep: async () => Promise.reject(new Error('async hook bug')),
    };
    const result = await new AgentHarness(scriptedLLM('ตอบ'), registryWith(), { hooks }).run({ text: 'x' });
    expect(result.reply).toBe('ตอบ');
    expect(error).toHaveBeenCalledWith('[agent] hook onStart ล้ม — ทำงานต่อ', expect.any(Error));
    expect(error).toHaveBeenCalledWith('[agent] hook onStep ล้ม — ทำงานต่อ', expect.any(Error));
  });
});

describe('app wiring (aiOrchestrator + moduleRegistry)', () => {
  beforeEach(async () => {
    await resetSettings();
    await setAIKeys(['gemini', 'openrouter']);
  });

  test('orchestratorLLM sends the transcript to the AI chain with temperature 0', async () => {
    const { calls } = mockFetch([[GEMINI, () => geminiText('{"final":"จาก Gemini"}')]]);
    const harness = new AgentHarness(orchestratorLLM(new Orchestrator()), registryWith());
    await expect(harness.run({ text: 'สวัสดี' })).resolves.toMatchObject({ reply: 'จาก Gemini' });
    const body = nth(calls, 0).body as { generationConfig: { temperature: number }; contents: unknown[] };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'สวัสดี' }] }]);
  });

  test('createAppAgent uses the app registry (no modules yet → no tools)', async () => {
    const agent = await createAppAgent({ maxSteps: 3 });
    expect(agent.maxSteps).toBe(3);
    expect(agent.availableTools()).toEqual([]);
  });
});
