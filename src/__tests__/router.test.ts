import { ProviderSettings } from '../core/storage/ProviderSettings';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import { PERSONA_PROMPTS } from '../features/ai/prompts/personaPrompts';
import { PERSONA_GREETINGS } from '../features/jarvis/constants';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { JevClassifier } from '../features/router/classifiers/JevClassifier';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  LLMClassifier,
  parseClassification,
} from '../features/router/classifiers/LLMClassifier';
import { RuleClassifier, findPersona } from '../features/router/classifiers/RuleClassifier';
import { IntentRouter, JEV_MIN_CONFIDENCE } from '../features/router/core/IntentRouter';
import type {
  Classifier,
  PersonaEntity,
  RouteOf,
  RouterOutput,
} from '../features/router/core/types';
import { ChatHandler } from '../features/router/handlers/ChatHandler';
import { PCCommandHandler } from '../features/router/handlers/PCCommandHandler';
import { SwitchAssistantHandler } from '../features/router/handlers/SwitchAssistantHandler';
import {
  GEMINI,
  JEV,
  OPENROUTER,
  geminiText,
  httpError,
  isClassifierCall,
  jevChoice,
  mockFetch,
  openRouterText,
} from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter', 'jev']);
  resetStore();
});

afterEach(() => jest.restoreAllMocks());

/** Classifier stub that records calls and returns a fixed answer (or throws). */
const stubClassifier = (out: RouterOutput | null | Error): Classifier & { calls: number } => {
  const c = {
    calls: 0,
    classify: async () => {
      c.calls++;
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return c;
};

describe('RuleClassifier', () => {
  const rule = new RuleClassifier();

  test.each([
    ['เรียกจาร์วิสหน่อย', '2'],
    ['เปลี่ยนเป็นไฟรเดย์', '3'],
    ['สลับไปอัลตรอน', '4'],
    ['เรียกอะตอมกลับมา', '1'],
    ['switch to Ultron', '4'],
    ['call jarvis please', '2'],
    ['เรียกฟรายเดย์', '3'], // common misspelling still maps to FRIDAY
    ['เปลี่ยนจากอะตอมเป็นจาร์วิส', '2'], // last-mentioned name is the target
  ])('switch_assistant: %s → persona %s', (text, persona) => {
    expect(rule.check(text)).toEqual({
      intent: 'switch_assistant',
      confidence: 0.95,
      entities: { persona },
      provider: 'rule',
    });
  });

  test.each([
    ['เปิดคอมให้หน่อย', 'เปิด', 'คอม'],
    ['ปิดเครื่องได้เลย', 'ปิด', 'เครื่อง'],
    ['สั่ง PC ให้รีสตาร์ท', 'สั่ง', 'PC'],
    ['shutdown the computer', 'shutdown', 'computer'],
  ])('pc_command: %s', (text, action, target) => {
    expect(rule.check(text)).toEqual({
      intent: 'pc_command',
      confidence: 0.9,
      entities: { action, target },
      provider: 'rule',
    });
  });

  test.each([
    'วันนี้อากาศเป็นยังไง',
    'เรียกแท็กซี่ให้หน่อย', // verb without a persona name
    'เปิดเพลงหน่อย', // verb without a computer target
    'ปิดไฟ',
    'จาร์วิสคือใคร', // name without a switch verb
    '',
  ])('no opinion (chat is decided later): %s', async (text) => {
    expect(rule.check(text)).toBeNull();
    await expect(rule.classify({ text })).resolves.toBeNull();
  });

  test('findPersona handles Thai/English aliases and no match', () => {
    expect(findPersona('ULTRON')).toBe(4);
    expect(findPersona('จาวิส')).toBe(2);
    expect(findPersona('ไม่มีชื่อ')).toBeUndefined();
  });
});

describe('LLMClassifier (Gemini → OpenRouter)', () => {
  test.each([
    ['{"intent":"chat","confidence":0.8}', { intent: 'chat', confidence: 0.8 }],
    ['```json\n{"intent":"pc_command","confidence":0.82}\n```', { intent: 'pc_command', confidence: 0.82 }],
    ['Sure: {"intent": "switch_assistant", "confidence": 95}', { intent: 'switch_assistant', confidence: 0.95 }],
    ['{"intent":"chat","confidence":"high"}', { intent: 'chat', confidence: 0.5 }],
    ['{"intent":"chat","confidence":-3}', { intent: 'chat', confidence: 0 }],
  ])('parseClassification(%s)', (text, expected) => {
    expect(parseClassification(text)).toEqual(expected);
  });

  test.each(['{"intent":"dance"}', 'no json here', '{not valid json}'])(
    'parseClassification rejects %s',
    (text) => expect(parseClassification(text)).toBeNull()
  );

  test('classifies via Gemini with the classifier prompt and extracts the persona entity', async () => {
    const { calls } = mockFetch([
      [GEMINI, () => geminiText('{"intent":"switch_assistant","confidence":0.88}')],
    ]);
    const out = await new LLMClassifier().classify({ text: 'ขอคุยกับไฟรเดย์' });
    expect(out).toEqual({
      intent: 'switch_assistant',
      confidence: 0.88,
      entities: { persona: '3' },
      provider: 'llm',
    });
    const body = nth(calls, 0).body as {
      systemInstruction: { parts: [{ text: string }] };
      generationConfig: { temperature: number; maxOutputTokens: number };
    };
    expect(body.systemInstruction.parts[0].text).toBe(CLASSIFIER_SYSTEM_PROMPT);
    expect(body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 50 });
  });

  test('falls back to OpenRouter when Gemini is rate limited', async () => {
    const { hosts, calls } = mockFetch([
      [GEMINI, () => httpError(429)],
      [OPENROUTER, () => openRouterText('{"intent":"pc_command","confidence":0.77}')],
    ]);
    const out = await new LLMClassifier().classify({ text: 'ช่วยรันสคริปต์บนเครื่องที' });
    expect(out).toMatchObject({ intent: 'pc_command', confidence: 0.77, provider: 'llm' });
    expect(out?.entities).toBeUndefined();
    expect(hosts()).toEqual(['generativelanguage.googleapis.com', 'openrouter.ai']);
    expect(nth(calls, 1).headers.Authorization).toBe('Bearer openrouter-test-key');
  });

  test('returns null when the LLM answers with something unparseable', async () => {
    mockFetch([[GEMINI, () => geminiText('I think it is a chat')]]);
    await expect(new LLMClassifier().classify({ text: 'อืม' })).resolves.toBeNull();
  });
});

describe('JevClassifier (TypeSafe System One)', () => {
  test('is skipped (no request) while Jev is disabled', async () => {
    const { spy } = mockFetch([]);
    const jev = new JevClassifier();
    await expect(jev.isEnabled()).resolves.toBe(false);
    await expect(jev.classify({ text: 'เปิดโปรแกรม' })).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test('sends a choice question with criteria for all 3 intents and recent messages', async () => {
    await ProviderSettings.setEnabled('jev', true);
    await ProviderSettings.setModelFor('jev', 'jev-preview');
    const { calls } = mockFetch([[JEV, () => jevChoice('pc_command', 0.91)]]);

    const out = await new JevClassifier().classify({
      text: 'ช่วยรันโปรแกรมให้ที',
      context: { recentMessages: ['a', 'b', 'c', 'd', 'e', 'f'] },
    });

    expect(out).toEqual({ intent: 'pc_command', confidence: 0.91, provider: 'jev' });
    expect(nth(calls, 0).url.pathname).toBe('/v1/systemone');
    expect(nth(calls, 0).headers.Authorization).toBe('Bearer jev-test-key');
    const body = nth(calls, 0).body as {
      model: string;
      state: { message: string; recent_messages: string[] };
      questions: { intent: { type: string; criteria: Record<string, string> } };
    };
    expect(body.model).toBe('jev-preview');
    expect(body.state).toEqual({ message: 'ช่วยรันโปรแกรมให้ที', recent_messages: ['b', 'c', 'd', 'e', 'f'] });
    expect(body.questions.intent.type).toBe('choice');
    expect(Object.keys(body.questions.intent.criteria)).toEqual([
      'chat',
      'pc_command',
      'switch_assistant',
    ]);
  });

  test('switch_assistant answer carries the persona entity; probabilities used when no confidence', async () => {
    await ProviderSettings.setEnabled('jev', true);
    mockFetch([[JEV, () => jevChoice('switch_assistant', undefined, { switch_assistant: 0.83 })]]);
    await expect(new JevClassifier().classify({ text: 'เอาอัลตรอนมา' })).resolves.toEqual({
      intent: 'switch_assistant',
      confidence: 0.83,
      entities: { persona: '4' },
      provider: 'jev',
    });
  });

  test('unknown choice → null; missing confidence and probabilities → 0', async () => {
    await ProviderSettings.setEnabled('jev', true);
    mockFetch([[JEV, () => jevChoice('weather')]]);
    await expect(new JevClassifier().classify({ text: 'x' })).resolves.toBeNull();

    jest.restoreAllMocks();
    mockFetch([[JEV, () => jevChoice('chat')]]);
    await expect(new JevClassifier().classify({ text: 'x' })).resolves.toMatchObject({
      intent: 'chat',
      confidence: 0,
    });
  });

  test('not registered → disabled', async () => {
    const registry = { get: () => undefined } as unknown as typeof aiRegistry;
    await expect(new JevClassifier(registry).isEnabled()).resolves.toBe(false);
  });
});

describe('IntentRouter pipeline', () => {
  const chatOut = (provider: RouterOutput['provider'], confidence: number): RouterOutput => ({
    intent: 'chat',
    confidence,
    provider,
  });

  test('rule match short-circuits Jev and LLM', async () => {
    const jev = stubClassifier(chatOut('jev', 0.99));
    const llm = stubClassifier(chatOut('llm', 0.99));
    const out = await new IntentRouter({ jev, llm }).route({ text: 'เปิดคอม' });
    expect(out.intent).toBe('pc_command');
    expect(jev.calls + llm.calls).toBe(0);
  });

  test(`Jev wins when confidence ≥ ${JEV_MIN_CONFIDENCE}, otherwise the LLM decides`, async () => {
    const llm = stubClassifier(chatOut('llm', 0.6));
    let router = new IntentRouter({ jev: stubClassifier(chatOut('jev', 0.71)), llm });
    expect((await router.route({ text: 'อืม' })).provider).toBe('jev');
    expect(llm.calls).toBe(0);

    router = new IntentRouter({ jev: stubClassifier(chatOut('jev', 0.6)), llm });
    expect((await router.route({ text: 'อืม' })).provider).toBe('llm');
  });

  describe(`confidence boundary (JEV_MIN_CONFIDENCE = ${JEV_MIN_CONFIDENCE})`, () => {
    test('exactly 0.7 → Jev decides, LLM never called', async () => {
      const llm = stubClassifier(chatOut('llm', 0.99));
      const out = await new IntentRouter({ jev: stubClassifier(chatOut('jev', 0.7)), llm }).route({
        text: 'อืม',
      });
      expect(out).toEqual({ intent: 'chat', confidence: 0.7, provider: 'jev' });
      expect(llm.calls).toBe(0);
    });

    test('just below 0.7 (0.6999) → LLM decides', async () => {
      const llm = stubClassifier(chatOut('llm', 0.8));
      const out = await new IntentRouter({ jev: stubClassifier(chatOut('jev', 0.6999)), llm }).route({
        text: 'อืม',
      });
      expect(out.provider).toBe('llm');
      expect(llm.calls).toBe(1);
    });

    test('end to end: TypeSafe answers with confidence 0.7 → routed by Jev, Gemini untouched', async () => {
      await ProviderSettings.setEnabled('jev', true);
      const { hosts } = mockFetch([[JEV, () => jevChoice('pc_command', 0.7)]]);
      const out = await new IntentRouter().route({ text: 'ช่วยรันโปรแกรมให้ที' });
      expect(out).toEqual({ intent: 'pc_command', confidence: 0.7, provider: 'jev' });
      expect(hosts()).toEqual(['api.typesafe.ai']);
    });

    test('end to end: confidence 0.7 taken from probabilities when confidence is absent', async () => {
      await ProviderSettings.setEnabled('jev', true);
      mockFetch([[JEV, () => jevChoice('chat', undefined, { chat: 0.7 })]]);
      await expect(new IntentRouter().route({ text: 'อืม' })).resolves.toMatchObject({
        provider: 'jev',
        confidence: 0.7,
      });
    });
  });

  test('Jev errors / no opinion fall through to the LLM', async () => {
    const llm = stubClassifier(chatOut('llm', 0.8));
    expect(
      (await new IntentRouter({ jev: stubClassifier(new Error('down')), llm }).route({ text: 'x' }))
        .provider
    ).toBe('llm');
    expect((await new IntentRouter({ jev: stubClassifier(null), llm }).route({ text: 'x' })).provider).toBe(
      'llm'
    );
  });

  test('every classifier unavailable → default chat; blank text never calls a classifier', async () => {
    const jev = stubClassifier(new Error('down'));
    const llm = stubClassifier(new Error('down'));
    const router = new IntentRouter({ jev, llm });
    const fallback = { intent: 'chat', confidence: 0.5, provider: 'rule' };
    await expect(router.route({ text: 'อืม' })).resolves.toEqual(fallback);
    await expect(router.route({ text: '   ' })).resolves.toEqual(fallback);
    expect(jev.calls).toBe(1);
  });

  test('end to end with real classifiers: Jev enabled → System One decides', async () => {
    await ProviderSettings.setEnabled('jev', true);
    const { hosts } = mockFetch([[JEV, () => jevChoice('chat', 0.93)]]);
    const out = await new IntentRouter().route({ text: 'เล่าเรื่องตลกหน่อย' });
    expect(out).toEqual({ intent: 'chat', confidence: 0.93, provider: 'jev' });
    expect(hosts()).toEqual(['api.typesafe.ai']);
  });

  test('end to end: Jev down → Gemini classifies', async () => {
    await ProviderSettings.setEnabled('jev', true);
    const { hosts } = mockFetch([
      [JEV, () => httpError(503)],
      [GEMINI, () => geminiText('{"intent":"chat","confidence":0.9}')],
    ]);
    const out = await new IntentRouter().route({ text: 'เล่าเรื่องตลกหน่อย' });
    expect(out.provider).toBe('llm');
    expect(hosts()).toEqual(['api.typesafe.ai', 'generativelanguage.googleapis.com']);
  });

  test('handle() dispatches each intent to its handler', async () => {
    const fixed = (out: RouterOutput) => ({ check: () => out }) as unknown as RuleClassifier;
    const handlers = {
      chat: { handle: jest.fn(async () => ({ reply: 'chat!', persona: 1 as const })) },
      pc_command: { handle: jest.fn(async () => ({ reply: 'pc!', persona: 1 as const })) },
      switch_assistant: { handle: jest.fn(async () => ({ reply: 'sw!', persona: 2 as const })) },
    };
    for (const intent of ['chat', 'pc_command', 'switch_assistant'] as const) {
      const route: RouterOutput = { intent, confidence: 1, provider: 'rule' };
      const { result } = await new IntentRouter({ rule: fixed(route), handlers }).handle({ text: 'x' });
      expect(handlers[intent].handle).toHaveBeenLastCalledWith({ text: 'x' }, route);
      expect(result.reply).toBe(intent === 'chat' ? 'chat!' : intent === 'pc_command' ? 'pc!' : 'sw!');
    }
  });
});

describe('Handlers', () => {
  test('ChatHandler: persona system prompt + history (last 20, no system turns) + user text', async () => {
    const { calls } = mockFetch([[GEMINI, () => geminiText('  ตอบแล้วครับ  ')]]);
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    history.splice(3, 0, { role: 'system' as never, content: 'should be dropped' });

    const res = await new ChatHandler().handle({
      text: 'สวัสดี',
      context: { activePersona: 3, history },
    });

    expect(res).toEqual({ reply: 'ตอบแล้วครับ', persona: 3 });
    const body = nth(calls, 0).body as {
      systemInstruction: { parts: [{ text: string }] };
      contents: { role: string; parts: [{ text: string }] }[];
    };
    expect(body.systemInstruction.parts[0].text).toContain(PERSONA_PROMPTS[3]);
    expect(body.contents).toHaveLength(21);
    expect(nth(body.contents, 0).parts[0].text).toBe('m5');
    expect(body.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: 'สวัสดี' }] });
    expect(JSON.stringify(body.contents)).not.toContain('should be dropped');
  });

  test('ChatHandler: defaults to ATOM and supports a custom (empty) prompt source', async () => {
    const { calls } = mockFetch([[GEMINI, () => geminiText('ok')]]);
    const res = await new ChatHandler(undefined, () => undefined).handle({ text: 'hi' });
    expect(res.persona).toBe(1);
    expect((nth(calls, 0).body as { systemInstruction?: unknown }).systemInstruction).toBeUndefined();
  });

  test('PCCommandHandler is a Phase 4 stub that keeps the persona', async () => {
    await expect(
      new PCCommandHandler().handle({ text: 'เปิดคอม', context: { activePersona: 2 } })
    ).resolves.toEqual({ reply: 'Phase 4 ครับ', persona: 2 });
    await expect(new PCCommandHandler().handle({ text: 'x' })).resolves.toMatchObject({ persona: 1 });
  });

  describe('SwitchAssistantHandler', () => {
    const route = (persona?: PersonaEntity): RouteOf<'switch_assistant'> => ({
      intent: 'switch_assistant',
      confidence: 1,
      provider: 'rule',
      ...(persona && { entities: { persona } }),
    });

    test('switches to the entity persona and answers with its greeting', async () => {
      const res = await new SwitchAssistantHandler().handle(
        { text: 'เรียกไฟรเดย์', context: { activePersona: 1 } },
        route('3')
      );
      expect(res).toEqual({ reply: PERSONA_GREETINGS[3], persona: 3 });
      expect(useAtomStore.getState().activePersona).toBe(3);
    });

    test('falls back to the name in the text when the entity is missing/invalid', async () => {
      const set = jest.fn();
      const res = await new SwitchAssistantHandler(set).handle(
        { text: 'ขอจาร์วิส', context: { activePersona: 1 } },
        // Deliberately out of range: checks the handler's runtime validation of entities
        route('9' as PersonaEntity)
      );
      expect(set).toHaveBeenCalledWith(2);
      expect(res.persona).toBe(2);
    });

    test('same persona → no switch; unknown target → asks who', async () => {
      const set = jest.fn();
      const handler = new SwitchAssistantHandler(set);
      await expect(
        handler.handle({ text: 'เรียกอะตอม', context: { activePersona: 1 } }, route('1'))
      ).resolves.toEqual({ reply: 'อะตอมอยู่ตรงนี้แล้วครับบอส', persona: 1 });
      await expect(handler.handle({ text: 'เปลี่ยนคน' }, route())).resolves.toEqual({
        reply: 'จะให้เรียกใครครับ อะตอม จาร์วิส ไฟรเดย์ หรืออัลตรอน',
        persona: 1,
      });
      expect(set).not.toHaveBeenCalled();
    });
  });
});

describe('Fetch mock sanity', () => {
  test('classifier calls are distinguishable from chat calls', async () => {
    const { calls } = mockFetch([
      [GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat","confidence":1}') : geminiText('hi'))],
    ]);
    await new LLMClassifier().classify({ text: 'x' });
    await new ChatHandler().handle({ text: 'x' });
    expect(calls.map(isClassifierCall)).toEqual([true, false]);
  });
});
