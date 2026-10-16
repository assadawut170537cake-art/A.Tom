import AsyncStorage from '@react-native-async-storage/async-storage';

import { AgentRegistry } from '../core/agents/AgentRegistry';
import type { AgentDefinition, AgentScreenComponent } from '../core/agents/types';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { parseClassification } from '../features/router/classifiers/LLMClassifier';
import type { RuleClassifier } from '../features/router/classifiers/RuleClassifier';
import { IntentRouter } from '../features/router/core/IntentRouter';
import { INTENTS, MODEL_INTENTS, type Classifier, type RouteOf } from '../features/router/core/types';
import { AGENT_NOT_FOUND_REPLY, AgentHandler } from '../features/router/handlers/AgentHandler';
import { MAX_NOTE_LENGTH, MAX_NOTES, NOTES_STORAGE_KEY, NoteStore } from '../modules/agents/noteStore';
import { createNoteAgent, NOTE_AGENT_ID, registerSampleAgents } from '../modules/agents/sample-agent';
import { nth } from '../test-utils/nth';

const Dummy: AgentScreenComponent = () => null;

function fakeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'calc',
    name: 'เครื่องคิดเลข',
    capabilities: [{ id: 'calc.eval', label: 'คิดเลข', patterns: [/^คิดเลข\s+(?<command>.+)$/] }],
    run: jest.fn(async ({ commandText }) => ({ reply: `ผลคือ ${commandText}` })),
    ...overrides,
  };
}

const agentRoute = (agentId: string, commandText = '', capabilityId?: string): RouteOf<'agent'> => ({
  intent: 'agent',
  confidence: 0.9,
  provider: 'agent',
  entities: { agentId, commandText, capabilityId },
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

describe('intents', () => {
  test('INTENTS has 4 entries; models still label only the original 3', () => {
    expect(INTENTS).toEqual(['chat', 'pc_command', 'switch_assistant', 'agent']);
    expect(MODEL_INTENTS).toEqual(['chat', 'pc_command', 'switch_assistant']);
  });

  test('LLM answering "agent" is ignored (it cannot say which agent)', () => {
    expect(parseClassification('{"intent":"agent","confidence":0.9}')).toBeNull();
  });
});

describe('AgentRegistry', () => {
  test('register / getAgent / list / has / unregister', () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent());
    registry.register(fakeAgent({ id: 'other', name: 'อีกตัว', capabilities: [], loadScreen: async () => Dummy }));

    expect(registry.has('calc')).toBe(true);
    expect(registry.getAgent('calc')).toEqual({
      id: 'calc',
      name: 'เครื่องคิดเลข',
      description: undefined,
      capabilities: [{ id: 'calc.eval', label: 'คิดเลข', examples: [] }],
      hasScreen: false,
    });
    expect(registry.list().map((a) => [a.id, a.hasScreen])).toEqual([
      ['calc', false],
      ['other', true],
    ]);
    expect(registry.getAgent('nope')).toBeUndefined();

    expect(registry.unregister('calc')).toBe(true);
    expect(registry.unregister('calc')).toBe(false);
    expect(registry.list().map((a) => a.id)).toEqual(['other']);
  });

  test('duplicate id is rejected', () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent());
    expect(() => registry.register(fakeAgent())).toThrow('ลงทะเบียนไว้แล้ว');
  });

  test('listCapabilities() keeps registration order', () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent());
    registry.register(createNoteAgent(new NoteStore('t')));
    expect(registry.listCapabilities().map((c) => `${c.agentId}:${c.capability.id}`)).toEqual([
      'calc:calc.eval',
      'note:note.add',
      'note:note.list',
    ]);
  });

  test('run() calls the agent; unknown id rejects', async () => {
    const agent = fakeAgent();
    const registry = new AgentRegistry();
    registry.register(agent);
    await expect(registry.run('calc', { text: 'x', commandText: '1+1', persona: 1 })).resolves.toEqual({ reply: 'ผลคือ 1+1' });
    await expect(registry.run('nope', { text: 'x', commandText: '', persona: 1 })).rejects.toThrow('ไม่พบ agent');
  });

  test('getScreenComponent() lazy-loads once and caches; no screen / unknown → null', async () => {
    const loadScreen = jest.fn(async () => Dummy);
    const registry = new AgentRegistry();
    registry.register(fakeAgent({ loadScreen }));
    registry.register(fakeAgent({ id: 'plain' }));

    expect(loadScreen).not.toHaveBeenCalled(); // lazy: nothing loaded at register time
    const [a, b] = await Promise.all([registry.getScreenComponent('calc'), registry.getScreenComponent('calc')]);
    expect(a).toBe(Dummy);
    expect(b).toBe(Dummy);
    await registry.getScreenComponent('calc');
    expect(loadScreen).toHaveBeenCalledTimes(1);

    await expect(registry.getScreenComponent('plain')).resolves.toBeNull();
    await expect(registry.getScreenComponent('nope')).resolves.toBeNull();
  });

  test('a failed load is not cached, so retry loads again', async () => {
    const loadScreen = jest.fn<Promise<AgentScreenComponent>, []>().mockRejectedValueOnce(new Error('chunk หาย')).mockResolvedValue(Dummy);
    const registry = new AgentRegistry();
    registry.register(fakeAgent({ loadScreen }));
    await expect(registry.getScreenComponent('calc')).rejects.toThrow('chunk หาย');
    await expect(registry.getScreenComponent('calc')).resolves.toBe(Dummy);
    expect(loadScreen).toHaveBeenCalledTimes(2);
  });
});

describe('AgentClassifier', () => {
  const classifier = () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent());
    registry.register(createNoteAgent(new NoteStore('t')));
    return new AgentClassifier(registry);
  };

  test.each([
    ['คิดเลข 2+3', 'calc', 'calc.eval', '2+3'],
    ['จดบันทึกว่า ซื้อนม', 'note', 'note.add', 'ซื้อนม'],
    ['  จดไว้ว่าพรุ่งนี้ประชุม 9 โมง  ', 'note', 'note.add', 'พรุ่งนี้ประชุม 9 โมง'],
    ['ช่วยจดว่า โทรหาแม่', 'note', 'note.add', 'โทรหาแม่'],
    ['note: buy milk', 'note', 'note.add', 'buy milk'],
    ['จดบันทึกว่า', 'note', 'note.add', ''],
    ['ดูโน้ต', 'note', 'note.list', ''],
    ['เปิดบันทึกทั้งหมด', 'note', 'note.list', ''],
    ['Show notes', 'note', 'note.list', ''],
  ])('match: %s', async (text, agentId, capabilityId, commandText) => {
    await expect(classifier().classify({ text })).resolves.toEqual({
      intent: 'agent',
      confidence: 0.9,
      provider: 'agent',
      entities: { agentId, capabilityId, commandText },
    });
  });

  test.each(['วันนี้เป็นไงบ้าง', 'บันทึกนี้ดีไหม', 'จดบันทึก', 'ช่วยดูโน้ตเพลงนี้หน่อย', '', '   '])(
    'no match → null: "%s"',
    async (text) => {
      await expect(classifier().classify({ text })).resolves.toBeNull();
    }
  );

  test('empty registry → null for everything', async () => {
    await expect(new AgentClassifier(new AgentRegistry()).classify({ text: 'จดบันทึกว่า x' })).resolves.toBeNull();
  });

  test('without a `command` group, commandText = text minus the matched part', () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent({ capabilities: [{ id: 'c', label: 'c', patterns: [/^ตั้งเวลา/] }] }));
    expect(new AgentClassifier(registry).check('ตั้งเวลา 5 นาที')).toMatchObject({ entities: { commandText: '5 นาที' } });
  });

  test('global regexes do not leak lastIndex between calls', () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent({ capabilities: [{ id: 'c', label: 'c', patterns: [/^ping/g] }] }));
    const c = new AgentClassifier(registry);
    expect(c.check('ping')).not.toBeNull();
    expect(c.check('ping')).not.toBeNull();
  });
});

describe('AgentHandler', () => {
  test('success: reply from the agent, persona from context, no screen unless asked', async () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent());
    const result = await new AgentHandler(registry).handle(
      { text: 'คิดเลข 2+3', context: { activePersona: 3 } },
      agentRoute('calc', '2+3', 'calc.eval')
    );
    expect(result).toEqual({ reply: 'ผลคือ 2+3', persona: 3 });
  });

  test('showScreen → agentScreen only when the agent has a screen', async () => {
    const registry = new AgentRegistry();
    const run = async () => ({ reply: 'ok', showScreen: true });
    registry.register(fakeAgent({ run, loadScreen: async () => Dummy }));
    registry.register(fakeAgent({ id: 'plain', run }));
    const handler = new AgentHandler(registry);
    await expect(handler.handle({ text: 'x' }, agentRoute('calc'))).resolves.toEqual({
      reply: 'ok',
      persona: 1,
      agentScreen: { agentId: 'calc' },
    });
    await expect(handler.handle({ text: 'x' }, agentRoute('plain'))).resolves.toEqual({ reply: 'ok', persona: 1 });
  });

  test('agent throws → Thai reply (not a thrown error), secrets redacted', async () => {
    const registry = new AgentRegistry();
    registry.register(fakeAgent({ run: async () => Promise.reject(new Error('key AIzaSyFAKE123 ใช้ไม่ได้')) }));
    const result = await new AgentHandler(registry).handle({ text: 'x' }, agentRoute('calc'));
    expect(result.reply).toBe('เครื่องคิดเลขทำงานไม่สำเร็จครับ — key [REDACTED] ใช้ไม่ได้');
    expect(result.agentScreen).toBeUndefined();
  });

  test('unknown agent → Thai "not found" reply', async () => {
    const result = await new AgentHandler(new AgentRegistry()).handle({ text: 'x' }, agentRoute('ghost'));
    expect(result).toEqual({ reply: AGENT_NOT_FOUND_REPLY, persona: 1 });
  });
});

describe('IntentRouter with agents', () => {
  const noModels = (): Classifier => ({ classify: jest.fn(async () => null) });

  test('order: Rule → Agent → Jev → LLM (agent match skips Jev and LLM)', async () => {
    const registry = new AgentRegistry();
    registry.register(createNoteAgent(new NoteStore('t')));
    const jev = noModels();
    const llm = noModels();
    const router = new IntentRouter({ agent: new AgentClassifier(registry), jev, llm });

    await expect(router.route({ text: 'จดบันทึกว่า ซื้อนม' })).resolves.toMatchObject({ intent: 'agent', provider: 'agent' });
    expect(jev.classify).not.toHaveBeenCalled();
    expect(llm.classify).not.toHaveBeenCalled();

    // Rule still wins first (documented trade-off in ADR-013)
    await expect(router.route({ text: 'เรียกจาร์วิส' })).resolves.toMatchObject({ intent: 'switch_assistant' });
    await expect(router.route({ text: 'จดบันทึกว่าปิดคอมตอนสี่ทุ่ม' })).resolves.toMatchObject({ intent: 'pc_command' });
  });

  test('no agent match → falls through to Jev / LLM / default chat as before', async () => {
    const llm = noModels();
    const router = new IntentRouter({ agent: new AgentClassifier(new AgentRegistry()), jev: noModels(), llm });
    await expect(router.route({ text: 'สวัสดี' })).resolves.toEqual({ intent: 'chat', confidence: 0.5, provider: 'rule' });
    expect(llm.classify).toHaveBeenCalledTimes(1);
  });

  test('a throwing agent classifier never blocks the user', async () => {
    const agent: Classifier = { classify: async () => Promise.reject(new Error('boom')) };
    const router = new IntentRouter({ agent, jev: noModels(), llm: noModels() });
    await expect(router.route({ text: 'สวัสดี' })).resolves.toMatchObject({ intent: 'chat' });
  });

  test('default router with an empty app-wide agentRegistry behaves as before', async () => {
    // nothing is registered in the singleton here (bootApp() isn't called) → agent stage is a no-op
    const llm = noModels();
    const router = new IntentRouter({ jev: noModels(), llm });
    await expect(router.route({ text: 'จดบันทึกว่า ซื้อนม' })).resolves.toEqual({ intent: 'chat', confidence: 0.5, provider: 'rule' });
    expect(llm.classify).toHaveBeenCalledTimes(1);
  });

  test('handle() dispatches agent routes to the agent handler', async () => {
    const agentHandler = { handle: jest.fn(async () => ({ reply: 'agent!', persona: 1 as const })) };
    const route = agentRoute('calc', '1');
    const rule = { check: () => route } as unknown as RuleClassifier;
    const { result } = await new IntentRouter({ rule, handlers: { agent: agentHandler } }).handle({ text: 'x' });
    expect(agentHandler.handle).toHaveBeenCalledWith({ text: 'x' }, route);
    expect(result.reply).toBe('agent!');
  });
});

describe('sample agent "โน้ต"', () => {
  test('note.add saves the note and asks for the screen', async () => {
    const store = new NoteStore();
    const agent = createNoteAgent(store);
    await expect(agent.run({ text: 'จดบันทึกว่า ซื้อนม', commandText: ' ซื้อนม ', capabilityId: 'note.add', persona: 1 })).resolves.toEqual({
      reply: 'จดแล้วครับบอส: “ซื้อนม”',
      showScreen: true,
    });
    expect((await store.list()).map((n) => n.text)).toEqual(['ซื้อนม']);
    // persisted
    const saved = JSON.parse((await AsyncStorage.getItem(NOTES_STORAGE_KEY)) ?? '[]') as { text: string }[];
    expect(nth(saved, 0).text).toBe('ซื้อนม');
  });

  test('note.add with nothing to write → Thai error (AgentHandler turns it into a reply)', async () => {
    const registry = new AgentRegistry();
    registry.register(createNoteAgent(new NoteStore()));
    const result = await new AgentHandler(registry).handle({ text: 'จดบันทึกว่า' }, agentRoute('note', '', 'note.add'));
    expect(result.reply).toContain('โน้ตทำงานไม่สำเร็จครับ — ยังไม่ได้บอกว่าจะจดอะไร');
    expect(result.agentScreen).toBeUndefined();
  });

  test('note.list reports the count and opens the screen', async () => {
    const store = new NoteStore();
    const agent = createNoteAgent(store);
    const list = { text: 'ดูโน้ต', commandText: '', capabilityId: 'note.list', persona: 1 as const };
    await expect(agent.run(list)).resolves.toEqual({ reply: 'ยังไม่มีโน้ตเลยครับ', showScreen: true });
    await store.add('a');
    await expect(agent.run(list)).resolves.toEqual({ reply: 'มีโน้ตอยู่ 1 รายการครับ', showScreen: true });
  });

  test('has a lazy screen (import() itself needs Metro; jest runs without vm-modules)', () => {
    const registry = new AgentRegistry();
    registry.register(createNoteAgent(new NoteStore()));
    expect(registry.getAgent(NOTE_AGENT_ID)).toMatchObject({ name: 'โน้ต', hasScreen: true });
  });

  test('registerSampleAgents() is idempotent', () => {
    const registry = new AgentRegistry();
    registerSampleAgents(registry);
    registerSampleAgents(registry);
    expect(registry.list().map((a) => a.id)).toEqual([NOTE_AGENT_ID]);
  });
});

describe('NoteStore', () => {
  test('newest first, remove, subscribe', async () => {
    const store = new NoteStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribe((notes) => seen.push(notes.length));
    const a = await store.add('แรก', 1);
    await store.add('สอง', 2);
    expect((await store.list()).map((n) => n.text)).toEqual(['สอง', 'แรก']);
    await store.remove(a.id);
    await store.remove('ไม่มี'); // no-op, no notification
    unsubscribe();
    await store.add('สาม', 3);
    expect(seen).toEqual([1, 2, 1]);
  });

  test('rejects too-long notes and caps the list', async () => {
    const store = new NoteStore();
    await expect(store.add('ก'.repeat(MAX_NOTE_LENGTH + 1))).rejects.toThrow('ยาวเกิน');
    for (let i = 0; i < MAX_NOTES + 3; i++) await store.add(`n${i}`, i);
    const notes = await store.list();
    expect(notes).toHaveLength(MAX_NOTES);
    expect(nth(notes, 0).text).toBe(`n${MAX_NOTES + 2}`);
  });

  test('corrupt entries are dropped, good ones kept', async () => {
    await AsyncStorage.setItem(
      NOTES_STORAGE_KEY,
      JSON.stringify([{ id: '1', text: 'ดี', createdAt: 1 }, { id: 2, text: 'เสีย' }, 'ขยะ'])
    );
    expect((await new NoteStore().list()).map((n) => n.text)).toEqual(['ดี']);
  });

  test('a failed write does not jam later writes', async () => {
    const store = new NoteStore();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(store.add('a')).rejects.toThrow('QuotaExceededError');
    await expect(store.add('b')).resolves.toMatchObject({ text: 'b' });
  });
});
