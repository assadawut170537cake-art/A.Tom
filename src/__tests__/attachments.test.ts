import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { ChatHistoryStorage } from '../core/storage/ChatHistoryStorage';
import { attachmentKind, type AttachmentData, type AttachmentRef } from '../core/types/attachment';
import { geminiParts, openAIMessage, withTextFiles } from '../features/ai/core/attachmentParts';
import {
  MAX_ATTACHMENT_BYTES,
  pickFiles,
  pickImages,
  readAttachment,
} from '../features/attachments/attachments';
import { NOTEBOOKLM_PREFIX } from '../features/attachments/prefills';
import { ATTACHMENT_ONLY_PROMPT, sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { IntentRouter } from '../features/router/core/IntentRouter';
import { AgentRegistry } from '../core/agents/AgentRegistry';
import { createNotebookLMAgent, parseNotebookCommand } from '../modules/agents/notebooklm-agent';
import { GEMINI, geminiText, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';
import type { BusClient } from '../features/pc-bridge/PcBridgeModule';

const IMG: AttachmentData = { name: 'a.jpg', mimeType: 'image/jpeg', kind: 'image', data: 'QUJD' };
const PDF: AttachmentData = {
  name: 'b.pdf',
  mimeType: 'application/pdf',
  kind: 'pdf',
  data: 'UERG',
};
const CODE: AttachmentData = {
  name: 'c.ts',
  mimeType: 'text/plain',
  kind: 'text',
  data: 'const x = 1;',
};

describe('ชนิดไฟล์', () => {
  test('เดาจาก mime + นามสกุล (ไฟล์โค้ดที่ Android บอกเป็น octet-stream = ข้อความ)', () => {
    expect(attachmentKind('x.png', 'image/png')).toBe('image');
    expect(attachmentKind('x.pdf', 'application/octet-stream')).toBe('pdf');
    expect(attachmentKind('main.py', 'application/octet-stream')).toBe('text');
    expect(attachmentKind('App.tsx', 'application/octet-stream')).toBe('text');
    expect(attachmentKind('v.mp4', 'video/mp4')).toBe('media');
    expect(attachmentKind('x.zip', 'application/zip')).toBe('other');
  });
});

describe('แปลงไฟล์ให้ provider', () => {
  test('Gemini: รูป/PDF = inlineData · โค้ด = ต่อท้ายข้อความเป็น code block', () => {
    const parts = geminiParts({
      role: 'user',
      content: 'ดูให้หน่อย',
      attachments: [IMG, PDF, CODE],
    });
    expect(nth(parts, 0)).toEqual({ text: withTextFiles('ดูให้หน่อย', [CODE]) });
    expect(nth(parts, 0)).toMatchObject({ text: expect.stringContaining('const x = 1;') });
    expect(parts.slice(1)).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
      { inlineData: { mimeType: 'application/pdf', data: 'UERG' } },
    ]);
  });

  test('OpenAI-compatible: รูป = image_url · PDF ส่งไม่ได้ → บอกในข้อความ (ไม่ทิ้งเงียบ)', () => {
    const m = openAIMessage({ role: 'user', content: 'ดู', attachments: [IMG, PDF] });
    expect(Array.isArray(m.content)).toBe(true);
    const content = m.content as Exclude<typeof m.content, string>;
    expect(nth(content, 1)).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,QUJD' },
    });
    expect(nth(content, 0)).toMatchObject({ text: expect.stringContaining('b.pdf') });
    // ไม่มีไฟล์ = string เหมือนเดิม (provider เก่าไม่พัง)
    expect(openAIMessage({ role: 'user', content: 'สวัสดี' })).toEqual({
      role: 'user',
      content: 'สวัสดี',
    });
  });
});

describe('เลือก/อ่านไฟล์', () => {
  test('เลือกรูป → AttachmentRef · ไฟล์ใหญ่เกิน = ตัดออกพร้อมข้อความไทย', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/1.jpg',
          width: 1,
          height: 1,
          fileName: '1.jpg',
          mimeType: 'image/jpeg',
          fileSize: 100,
        },
        {
          uri: 'file:///cache/2.jpg',
          width: 1,
          height: 1,
          fileName: '2.jpg',
          mimeType: 'image/jpeg',
          fileSize: MAX_ATTACHMENT_BYTES + 1,
        },
      ],
    } as never);
    const res = await pickImages();
    expect(res.files.map((f) => f.name)).toEqual(['1.jpg']);
    expect(res.error).toContain('2.jpg');
  });

  test('เลือกไฟล์โค้ด → kind text · ยกเลิก = ว่างไม่มี error', async () => {
    expect(await pickFiles()).toEqual({ files: [] });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/main.py',
          name: 'main.py',
          mimeType: 'application/octet-stream',
          size: 20,
          lastModified: 0,
        },
      ],
    } as never);
    expect(nth((await pickFiles()).files, 0)).toMatchObject({ name: 'main.py', kind: 'text' });
  });

  test('อ่านไฟล์: ชนิดที่ไม่รองรับ = null + เหตุผล · รูป = base64', async () => {
    const other: AttachmentRef = {
      name: 'x.zip',
      mimeType: 'application/zip',
      kind: 'other',
      uri: 'file:///x.zip',
    };
    expect((await readAttachment(other)).data).toBeNull();
    const img: AttachmentRef = {
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      kind: 'image',
      uri: 'file:///cache/a.jpg',
    };
    expect((await readAttachment(img)).data).toMatchObject({ kind: 'image', data: 'UklGRg==' });
  });
});

describe('ส่งไฟล์ในแชท', () => {
  beforeAll(registerAll);
  beforeEach(async () => {
    await resetSettings();
    await setAIKeys(['gemini']);
    resetStore();
  });
  afterEach(() => jest.restoreAllMocks());

  test('แนบรูปแบบไม่พิมพ์ → ข้อความตั้งต้น · ไม่เสีย request ให้ classifier · Gemini ได้ inlineData · ประวัติเก็บแค่ที่อยู่', async () => {
    const { calls } = mockFetch([[GEMINI, () => geminiText('เป็นรูปแมวครับ')]]);
    const ref: AttachmentRef = {
      name: 'cat.jpg',
      mimeType: 'image/jpeg',
      kind: 'image',
      uri: 'file:///cache/cat.jpg',
    };
    const res = await sendMessage('', { attachments: [ref], speak: false });
    expect(res.reply).toBe('เป็นรูปแมวครับ');
    expect(calls).toHaveLength(1); // ไม่มีรอบ classify
    const body = nth(calls, 0).body as { contents: { parts: unknown[] }[] };
    const last = nth(body.contents, body.contents.length - 1);
    expect(last.parts).toContainEqual({ inlineData: { mimeType: 'image/jpeg', data: 'UklGRg==' } });
    const userMsg = nth(useAtomStore.getState().messagesByPersona[1], 0);
    expect(userMsg).toMatchObject({ content: ATTACHMENT_ONLY_PROMPT, attachments: [ref] });
    expect(JSON.stringify(userMsg)).not.toContain('UklGRg=='); // ไม่เก็บเนื้อไฟล์
  });

  test('router: มีไฟล์แนบ = chat เสมอ (แม้ข้อความดูเป็นคำสั่ง)', async () => {
    const route = await new IntentRouter().route({ text: 'เปิดคอม', attachments: [IMG] });
    expect(route).toMatchObject({ intent: 'chat', provider: 'rule' });
  });

  test('โหลดประวัติ: ไฟล์แนบที่เสียตัดทิ้งเฉพาะไฟล์ ข้อความยังอยู่', async () => {
    await AsyncStorage.setItem(
      'atom.history.v1.1',
      JSON.stringify([
        {
          id: 'a',
          persona: 1,
          role: 'user',
          content: 'ดูรูป',
          createdAt: 1,
          attachments: [{ name: 1 }],
        },
      ]),
    );
    const loaded = await ChatHistoryStorage.loadAll();
    expect(loaded.ok && loaded.histories[1]).toEqual([
      { id: 'a', persona: 1, role: 'user', content: 'ดูรูป', createdAt: 1, attachments: undefined },
    ]);
  });
});

describe('NotebookLM (ผ่าน Mark 55)', () => {
  test('ข้อความจากเมนู + ตรง pattern ของ agent', () => {
    const registry = new AgentRegistry();
    registry.register(createNotebookLMAgent());
    expect(
      new AgentClassifier(registry).check(`${NOTEBOOKLM_PREFIX}https://example.com`),
    ).toMatchObject({
      entities: { agentId: 'notebooklm', commandText: ': https://example.com' },
    });
  });

  test('แยกลิงก์ / YouTube / ข้อความ · "ใหม่ ชื่อ X:" = notebook ใหม่', () => {
    expect(parseNotebookCommand(': https://youtu.be/abc และ https://a.com/x. สรุปบทความ')).toEqual({
      title: '',
      sources: [
        { type: 'youtube', value: 'https://youtu.be/abc' },
        { type: 'url', value: 'https://a.com/x' },
        { type: 'text', value: 'และ สรุปบทความ', name: 'และ สรุปบทความ' },
      ],
    });
    expect(parseNotebookCommand(' ใหม่ ชื่อ วิจัย AI: https://a.com').title).toBe('วิจัย AI');
  });

  test('ส่งงาน NOTEBOOKLM_ADD แล้วตอบผลจาก Mark 55', async () => {
    const submit = jest.fn(async () => 'task-1');
    const client: BusClient = {
      submitTask: submit,
      getTask: async () => ({
        taskId: 'task-1',
        instruction: 'NOTEBOOKLM_ADD',
        claimedBy: null,
        status: 'COMPLETED',
        result: { status: 'ADDED', message: '📒 ใส่ 1 รายการแล้ว' },
      }),
    };
    const agent = createNotebookLMAgent({
      settings: { load: async () => ({}) as never },
      createClient: () => client,
      sleep: async () => {},
    });
    const res = await agent.run({ text: '', commandText: ': https://a.com', persona: 1 });
    expect(submit).toHaveBeenCalledWith('NOTEBOOKLM_ADD', {
      sources: [{ type: 'url', value: 'https://a.com' }],
    });
    expect(res.reply).toBe('📒 ใส่ 1 รายการแล้ว');
  });
});
