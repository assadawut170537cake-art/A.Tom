import { fireEvent, render, screen } from '@testing-library/react-native';

import { AgentHarness } from '../core/agent/AgentHarness';
import type { AgentMessage, AgentToolProvider } from '../core/agent/types';
import { LocalMemoryAdapter, localMemory } from '../core/memory/LocalMemoryAdapter';
import { extractMemorySuggestions, stripMemoryMarkers } from '../core/memory/suggestions';
import { ALL_MEMORY_TARGETS } from '../core/memory/types';
import { ModuleRegistry } from '../core/modules/ModuleRegistry';
import { createChatToolAgent, type ChatToolAgent } from '../features/ai/agent';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { ChatBubble } from '../features/jarvis/components/chat/ChatBubble';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { ChatHandler } from '../features/router/handlers/ChatHandler';
import { GEMINI, geminiText, isClassifierCall, json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini']);
  resetStore();
  for (const target of ALL_MEMORY_TARGETS) await localMemory.clear(target);
  useAtomStore.setState({ historyLoaded: true, streamingId: null });
});

afterEach(() => jest.restoreAllMocks());

describe('extractMemorySuggestions', () => {
  test('ตัดมาร์กเกอร์ออกจากคำตอบ + แปลง key เป็น snake_case', () => {
    const { text, suggestions } = extractMemorySuggestions(
      'ส้มตำอร่อยครับ\n\n[[จำ: favorite food = ส้มตำปูปลาร้า]]\n[[remember: Allergy=กุ้ง]]'
    );
    expect(text).toBe('ส้มตำอร่อยครับ');
    expect(suggestions).toEqual([
      { key: 'favorite_food', value: 'ส้มตำปูปลาร้า' },
      { key: 'allergy', value: 'กุ้ง' },
    ]);
  });

  test('key ภาษาไทยล้วน / ค่าว่าง / ซ้ำ ถูกทิ้ง · ไม่เกิน 3 ข้อ', () => {
    const many = ['[[จำ: ชื่อ=ต้น]]', '[[จำ: a= ]]', '[[จำ: a=1]]', '[[จำ: a=2]]', '[[จำ: b=2]]', '[[จำ: c=3]]', '[[จำ: d=4]]'].join(' ');
    expect(extractMemorySuggestions(`ok ${many}`).suggestions.map((s) => s.key)).toEqual(['a', 'b', 'c']);
  });

  test('ระหว่างไหล: ซ่อนมาร์กเกอร์ที่ยังมาไม่ครบ แต่ไม่กินลิงก์ markdown', () => {
    expect(stripMemoryMarkers('ได้ครับ\n[[จำ: na')).toBe('ได้ครับ');
    expect(stripMemoryMarkers('ได้ครับ [')).toBe('ได้ครับ');
    expect(stripMemoryMarkers('ดู [ที่นี่')).toBe('ดู [ที่นี่');
    expect(stripMemoryMarkers('ok [[จำ: a=1]] ต่อ')).toBe('ok  ต่อ');
  });
});

describe('ChatHandler — ความจำที่เสนอ + agent ใช้ tool', () => {
  const handle = (handler: ChatHandler, text = 'ผมชอบส้มตำ') => handler.handle({ text, context: { activePersona: 1 } });

  test('คืน memorySuggestions และตัดออกจาก reply · เรื่องที่จำไว้แล้วไม่ถามซ้ำ', async () => {
    const memory = new LocalMemoryAdapter();
    await memory.save({ scope: 'global' }, 'name', 'ต้น');
    mockFetch([[GEMINI, () => geminiText('รับทราบครับ [[จำ: favorite_food=ส้มตำ]] [[จำ: name=ต้น]]')]]);
    const res = await handle(new ChatHandler(new Orchestrator(), () => 'P', memory));
    expect(res.reply).toBe('รับทราบครับ');
    expect(res.memorySuggestions).toEqual([{ key: 'favorite_food', value: 'ส้มตำ' }]);
  });

  test('ไม่มี memory store → ไม่แตะคำตอบ (backward compatible)', async () => {
    mockFetch([[GEMINI, () => geminiText('x [[จำ: a=1]]')]]);
    const res = await handle(new ChatHandler(new Orchestrator(), () => 'P'));
    expect(res).toEqual({ reply: 'x [[จำ: a=1]]', persona: 1 });
  });

  test('มี tool เปิดอยู่ → ตอบผ่าน agent (ส่ง history + persona prompt)', async () => {
    const { calls } = mockFetch([]);
    const agent: ChatToolAgent = { hasTools: jest.fn(async () => true), run: jest.fn(async () => 'เปิดไฟแล้วครับ') };
    const res = await new ChatHandler(new Orchestrator(), () => 'P', new LocalMemoryAdapter(), agent).handle({
      text: 'เปิดไฟห้องนอน',
      context: { activePersona: 2, history: [{ role: 'user', content: 'ก่อนหน้า' }] },
    });
    expect(res.reply).toBe('เปิดไฟแล้วครับ');
    expect(calls).toHaveLength(0);
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'เปิดไฟห้องนอน', persona: 2, history: [{ role: 'user', content: 'ก่อนหน้า' }] })
    );
    expect(jest.mocked(agent.run).mock.calls[0]?.[0].systemPrompt).toMatch(/^P\n\n/);
  });

  test('ไม่มี tool / agent ล้ม / มีไฟล์แนบ → แชทปกติ', async () => {
    mockFetch([[GEMINI, () => geminiText('ปกติ')]]);
    const none: ChatToolAgent = { hasTools: async () => false, run: jest.fn() };
    expect((await handle(new ChatHandler(new Orchestrator(), () => 'P', undefined, none))).reply).toBe('ปกติ');
    expect(none.run).not.toHaveBeenCalled();

    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: ChatToolAgent = { hasTools: async () => true, run: () => Promise.reject(new Error('llm')) };
    expect((await handle(new ChatHandler(new Orchestrator(), () => 'P', undefined, broken))).reply).toBe('ปกติ');
    expect(error).toHaveBeenCalledWith('[chat] agent ใช้ tool ไม่สำเร็จ — ตอบแบบแชทปกติแทน', expect.any(Error));

    const withTools: ChatToolAgent = { hasTools: jest.fn(async () => true), run: jest.fn() };
    await new ChatHandler(new Orchestrator(), () => 'P', undefined, withTools).handle({
      text: 'ดูรูปนี้',
      attachments: [{ mimeType: 'image/png', data: 'AA==', name: 'a.png' }],
    });
    expect(withTools.hasTools).not.toHaveBeenCalled();
  });
});

describe('createChatToolAgent + harness history', () => {
  const provider = (tools: string[]): AgentToolProvider => ({
    listTools: () => tools.map((id) => ({ id, name: id, source: 'mcp' as const })),
    call: async () => ({ ok: true, output: 'done' }),
  });

  test('นับเฉพาะ tool จาก MCP/ทักษะ/อุปกรณ์ · สร้าง harness ครั้งเดียว', async () => {
    const seen: AgentMessage[][] = [];
    const llm = { chat: async (m: AgentMessage[]) => (seen.push([...m]), '{"final":"สวัสดีครับ"}') };
    const build = jest.fn(async () => new AgentHarness(llm, new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } }), { providers: [provider(['mcp.a.b'])] }));
    const agent = createChatToolAgent(build);
    expect(await agent.hasTools()).toBe(true);
    expect(await agent.run({ text: 'หวัดดี', history: [{ role: 'assistant', content: 'ก่อน' }] })).toBe('สวัสดีครับ');
    expect(build).toHaveBeenCalledTimes(1);
    expect(nth(seen, 0).map((m) => m.role)).toEqual(['system', 'assistant', 'user']);

    const empty = createChatToolAgent(async () => new AgentHarness(llm, new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } }), { providers: [provider([])] }));
    expect(await empty.hasTools()).toBe(false);
  });
});

describe('แชท: ชิป "จำไว้ไหม"', () => {
  const chatRoute = (reply: string) =>
    mockFetch([
      [
        GEMINI,
        (c) =>
          isClassifierCall(c)
            ? json({ candidates: [{ content: { parts: [{ text: '{"intent":"chat","confidence":0.9}' }] } }] })
            : geminiText(reply),
      ],
    ]);

  test('sendMessage แนบข้อเสนอในข้อความ → กด "จำ" บันทึกลง Shared Memory แล้วชิปหายไป', async () => {
    chatRoute('จดไว้แล้วครับ [[จำ: allergy=แพ้กุ้ง]]');
    await sendMessage('ผมแพ้กุ้งนะ', { speak: false });
    const reply = nth(useAtomStore.getState().messagesByPersona[1], 1);
    expect(reply).toMatchObject({ content: 'จดไว้แล้วครับ', memorySuggestions: [{ key: 'allergy', value: 'แพ้กุ้ง' }] });

    const { rerender } = await render(<ChatBubble message={reply} />);
    await fireEvent.press(screen.getByLabelText('จำ แพ้กุ้ง'));
    expect(await localMemory.load({ scope: 'global' }, 'allergy')).toMatchObject({ value: 'แพ้กุ้ง', source: 'assistant' });
    const updated = nth(useAtomStore.getState().messagesByPersona[1], 1);
    expect(updated.memorySuggestions).toBeUndefined();
    await rerender(<ChatBubble message={updated} />);
    expect(screen.queryByText(/จำไว้ไหม/)).toBeNull();
  });

  test('กด "ไม่ต้อง" → ไม่บันทึก', async () => {
    chatRoute('โอเค [[จำ: pet=แมว]]');
    await sendMessage('ผมเลี้ยงแมว', { speak: false });
    const reply = nth(useAtomStore.getState().messagesByPersona[1], 1);
    await render(<ChatBubble message={reply} />);
    await fireEvent.press(screen.getByLabelText('ไม่ต้องจำ แมว'));
    expect(await localMemory.load({ scope: 'global' }, 'pet')).toBeNull();
    expect(nth(useAtomStore.getState().messagesByPersona[1], 1).memorySuggestions).toBeUndefined();
  });
});
