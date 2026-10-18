import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { archiveKey, ChatArchiveStorage, chatTitle } from '../core/storage/ChatArchiveStorage';
import { historyKey } from '../core/storage/ChatHistoryStorage';
import type { Message } from '../core/types/message';
import { MarkdownText } from '../features/jarvis/components/chat/MarkdownText';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { searchChats } from '../features/jarvis/utils/chatSearch';
import { parseInline, parseMarkdown, stripMarkdown } from '../features/jarvis/utils/markdown';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { RootNavigator } from '../navigation/RootNavigator';
import { GEMINI, geminiText, isClassifierCall, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const msg = (id: string, role: Message['role'], content: string, createdAt = 1): Message => ({
  id,
  persona: 1,
  role,
  content,
  createdAt,
});

beforeAll(registerAll);

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetSettings();
  await setAIKeys(['gemini']);
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  resetStore();
  useAtomStore.setState({ historyLoaded: true });
});

afterEach(() => jest.restoreAllMocks());

describe('markdown', () => {
  test('inline: bold, italic, code, link', () => {
    expect(parseInline('ก **หนา** *เอียง* `x` [ลิงก์](https://a.b/c)')).toEqual([
      { type: 'text', text: 'ก ' },
      { type: 'bold', children: [{ type: 'text', text: 'หนา' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'เอียง' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'x' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'ลิงก์', url: 'https://a.b/c' },
    ]);
  });

  test('math with spaced asterisks stays plain text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });

  test('non-http links are not turned into links', () => {
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.type === 'link')).toBe(false);
  });

  test('blocks: heading, lists, code, quote, table, rule', () => {
    const blocks = parseMarkdown(
      ['# หัวข้อ', '', '- หนึ่ง', '- สอง', '', '1. ก', '2. ข', '', '```ts', 'const a = 1', '```', '> คำคม', '---', '| a | b |', '|---|---|', '| 1 | 2 |', 'จบ'].join('\n')
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'list', 'code', 'quote', 'rule', 'table', 'paragraph']);
    const [, bullets, ordered, code, , , table] = blocks;
    expect(bullets).toMatchObject({ ordered: false, items: [{ marker: '•' }, { marker: '•' }] });
    expect(ordered).toMatchObject({ ordered: true, items: [{ marker: '1.' }, { marker: '2.' }] });
    expect(code).toEqual({ type: 'code', text: 'const a = 1', lang: 'ts' });
    expect(table).toEqual({ type: 'table', text: 'a  │  b\n1  │  2' });
  });

  test('unclosed code fence (cut-off reply) still renders as code', () => {
    expect(parseMarkdown('```\nline')).toEqual([{ type: 'code', text: 'line', lang: '' }]);
  });

  test('stripMarkdown removes symbols TTS would read aloud', () => {
    expect(stripMarkdown('## สรุป\n- **ข้อแรก** ดู [เว็บ](https://x.y)\n`code`')).toBe('สรุป\nข้อแรก ดู เว็บ\ncode');
  });

  test('MarkdownText renders formatted text without raw symbols', async () => {
    await render(<MarkdownText text={'**หนา** และ\n- รายการ'} accent="#fff" />);
    expect(screen.getByText('หนา')).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getByText('รายการ')).toBeTruthy();
  });
});

describe('multiple chats per persona', () => {
  test('newChat archives the current chat and persists both keys', async () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'สวัสดีอะตอม' });
    store.pushMessage({ role: 'assistant', content: 'ว่าไง' });
    store.newChat();
    await settle();
    const s = useAtomStore.getState();
    expect(s.messagesByPersona[1]).toEqual([]);
    expect(s.archivesByPersona[1]).toHaveLength(1);
    expect(nth(s.archivesByPersona[1], 0).title).toBe('สวัสดีอะตอม');
    expect(JSON.parse((await AsyncStorage.getItem(historyKey(1))) ?? 'null')).toEqual([]);
    expect(JSON.parse((await AsyncStorage.getItem(archiveKey(1))) ?? '[]')).toHaveLength(1);
  });

  test('newChat on an empty chat does nothing', () => {
    useAtomStore.getState().newChat();
    expect(useAtomStore.getState().archivesByPersona[1]).toEqual([]);
  });

  test('openChat swaps the archived chat with the current one', () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'ห้องแรก' });
    store.newChat();
    store.pushMessage({ role: 'user', content: 'ห้องสอง' });
    const first = nth(useAtomStore.getState().archivesByPersona[1], 0);
    useAtomStore.getState().openChat(1, first.id);
    const s = useAtomStore.getState();
    expect(nth(s.messagesByPersona[1], 0).content).toBe('ห้องแรก');
    expect(s.archivesByPersona[1].map((c) => c.title)).toEqual(['ห้องสอง']);
  });

  test('deleteChat removes an archive', () => {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'ลบฉัน' });
    store.newChat();
    useAtomStore.getState().deleteChat(1, nth(useAtomStore.getState().archivesByPersona[1], 0).id);
    expect(useAtomStore.getState().archivesByPersona[1]).toEqual([]);
  });

  test('archives load back from storage; corrupt entries are dropped', async () => {
    await ChatArchiveStorage.save(1, [
      { id: 'a', title: 'เก่า', createdAt: 1, updatedAt: 5, messages: [msg('m1', 'user', 'เก่า')] },
    ]);
    await AsyncStorage.setItem(archiveKey(2), '{oops');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const loaded = await ChatArchiveStorage.loadAll();
    expect(loaded[1].map((c) => c.id)).toEqual(['a']);
    expect(loaded[2]).toEqual([]);
  });

  test('chatTitle uses the first user message, trimmed', () => {
    expect(chatTitle([msg('1', 'assistant', 'hi'), msg('2', 'user', '  ก   ข  ')])).toBe('ก ข');
    expect(chatTitle([msg('1', 'user', 'x'.repeat(60))])).toHaveLength(41);
  });

  test('searchChats matches titles and contents with a snippet', () => {
    const chats = [
      { id: 'a', title: 'สูตรอาหาร', createdAt: 1, updatedAt: 1, messages: [msg('1', 'user', 'สูตรอาหาร')] },
      { id: 'b', title: 'งาน', createdAt: 1, updatedAt: 1, messages: [msg('2', 'assistant', 'ประชุมวันจันทร์ตอนเก้าโมง')] },
    ];
    expect(searchChats(chats, '').map((h) => h.chat.id)).toEqual(['a', 'b']);
    const hits = searchChats(chats, 'วันจันทร์');
    expect(hits.map((h) => h.chat.id)).toEqual(['b']);
    expect(nth(hits, 0).snippet).toContain('วันจันทร์');
  });
});

describe('message actions', () => {
  async function renderMain() {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByLabelText('ช่องพิมพ์ข้อความ');
    await settle();
  }

  test('long-press → copy puts the text on the clipboard', async () => {
    useAtomStore.setState({ uiMode: 'conversation' });
    useAtomStore.getState().pushMessage({ role: 'assistant', content: 'คำตอบ **สำคัญ**' });
    await renderMain();
    await fireEvent(screen.getByText('สำคัญ'), 'longPress');
    await fireEvent.press(await screen.findByText('คัดลอก'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('คำตอบ **สำคัญ**');
  });

  test('edit removes the message and following ones, and refills the composer', async () => {
    useAtomStore.setState({ uiMode: 'conversation' });
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'คำถามผิด' });
    store.pushMessage({ role: 'assistant', content: 'คำตอบ' });
    await renderMain();
    await fireEvent(screen.getByText('คำถามผิด'), 'longPress');
    await fireEvent.press(await screen.findByText('แก้ไข'));
    await settle();
    expect(useAtomStore.getState().messagesByPersona[1]).toEqual([]);
    expect(screen.getByLabelText('ช่องพิมพ์ข้อความ').props.value).toBe('คำถามผิด');
  });

  test('regenerate re-asks the same question without the old answer in history', async () => {
    jest.spyOn(voiceOrchestrator, 'speak').mockResolvedValue(undefined);
    useAtomStore.setState({ uiMode: 'conversation' });
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'user', content: 'ถามอีกที' });
    store.pushMessage({ role: 'assistant', content: 'คำตอบเก่า' });
    const { calls } = mockFetch([
      [GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat","confidence":0.9}') : geminiText('คำตอบใหม่'))],
    ]);
    await renderMain();
    await fireEvent(screen.getByText('คำตอบเก่า'), 'longPress');
    await fireEvent.press(await screen.findByText('ตอบใหม่'));
    await settle();
    await settle();
    expect(useAtomStore.getState().messagesByPersona[1].map((m) => m.content)).toEqual(['ถามอีกที', 'คำตอบใหม่']);
    const chatCall = calls.find((c) => !isClassifierCall(c));
    expect(JSON.stringify(chatCall?.body)).not.toContain('คำตอบเก่า');
  });

  test('system notices show one line until tapped', async () => {
    useAtomStore.setState({ uiMode: 'conversation' });
    useAtomStore.getState().pushMessage({ role: 'system', content: '⚠️ ถอดเสียงไม่สำเร็จ\n[whisper] หมดเวลา\n[deepgram] ไม่มี key' });
    await renderMain();
    expect(screen.queryByText(/\[whisper\]/)).toBeNull();
    await fireEvent.press(screen.getByText('⚠️ ถอดเสียงไม่สำเร็จ'));
    expect(screen.getByText(/\[whisper\] หมดเวลา/)).toBeTruthy();
  });

  test('history button opens the chat list; new chat archives the current one', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ห้องเดิม' });
    await renderMain();
    await fireEvent.press(screen.getByLabelText('ประวัติ'));
    expect(await screen.findByText('ประวัติแชท · อะตอม')).toBeTruthy();
    expect(screen.getByText('กำลังคุย')).toBeTruthy();
    await fireEvent.press(screen.getByText('แชทใหม่'));
    expect(useAtomStore.getState().messagesByPersona[1]).toEqual([]);
    expect(useAtomStore.getState().archivesByPersona[1]).toHaveLength(1);
  });

  test('plus button opens the add sheet', async () => {
    useAtomStore.getState().pushMessage({ role: 'user', content: 'x' });
    await renderMain();
    await fireEvent.press(screen.getByLabelText('เพิ่ม'));
    await fireEvent.press(await screen.findByText('แชทใหม่'));
    expect(useAtomStore.getState().archivesByPersona[1]).toHaveLength(1);
  });
});
