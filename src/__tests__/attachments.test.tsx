import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ChatHistoryStorage, historyKey } from '../core/storage/ChatHistoryStorage';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import type { Attachment } from '../core/types/message';
import { aiRegistry } from '../features/ai/core/ProviderRegistry';
import { describeAttachments, MAX_ATTACHMENT_BYTES, pickDocument, pickImage, takePhoto } from '../features/jarvis/services/attachments';
import { sendMessage } from '../features/jarvis/services/conversation';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { RootNavigator } from '../navigation/RootNavigator';
import { GEMINI, OPENROUTER, isClassifierCall, json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const image: Attachment = { id: 'a1', kind: 'image', uri: 'file:///docs/attachments/cat.jpg', mimeType: 'image/jpeg', name: 'cat.jpg', size: 10 };
const pdf: Attachment = { id: 'a2', kind: 'file', uri: 'file:///docs/attachments/a.pdf', mimeType: 'application/pdf', name: 'a.pdf', size: 10 };
const geminiReply = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });

beforeAll(registerAll);

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
  await ProviderSettings.setAdvanced({ streaming: false });
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  resetStore();
  useAtomStore.setState({ historyLoaded: true, pendingAttachments: [] });
  jest.spyOn(voiceOrchestrator, 'speak').mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('pickers', () => {
  test('pickImage copies the photo into the app folder', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/x.jpg', fileName: 'x.jpg', mimeType: 'image/jpeg', fileSize: 1000, width: 1, height: 1 }],
    });
    const att = await pickImage();
    expect(att).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', name: 'x.jpg', size: 1000 });
    expect(att?.uri).toContain('file:///docs/attachments/');
  });

  test('cancel → null; too big → Thai error; no camera permission → Thai error', async () => {
    expect(await pickImage()).toBeNull();
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/big.pdf', name: 'big.pdf', size: MAX_ATTACHMENT_BYTES + 1, mimeType: 'application/pdf', lastModified: 0 }],
    });
    await expect(pickDocument()).rejects.toThrow('ใหญ่เกิน 15MB');
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(takePhoto()).rejects.toThrow('ยังไม่ได้อนุญาตให้ใช้กล้อง');
  });

  test('describeAttachments names old files instead of resending them', () => {
    expect(describeAttachments([image, pdf])).toBe('[แนบรูป: cat.jpg] [แนบไฟล์: a.pdf]');
    expect(describeAttachments(undefined)).toBe('');
  });
});

describe('sending attachments', () => {
  test('Gemini gets inline_data, router is skipped, attachments are saved with the message', async () => {
    await ProviderSettings.setPriority(['gemini']);
    const { calls } = mockFetch([[GEMINI, () => geminiReply('เป็นแมวครับ')]]);
    await sendMessage('', { attachments: [image], speak: false });
    expect(calls.some(isClassifierCall)).toBe(false);
    const parts = (nth(calls, 0).body as { contents: { parts: unknown[] }[] }).contents.at(-1)?.parts;
    expect(parts).toEqual([{ text: 'ช่วยดูไฟล์ที่แนบมาให้หน่อย' }, { inline_data: { mime_type: 'image/jpeg', data: 'UklGRg==' } }]);
    const [userMsg, reply] = useAtomStore.getState().messagesByPersona[1];
    expect(userMsg?.attachments).toEqual([image]);
    expect(reply?.content).toBe('เป็นแมวครับ');
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const saved = JSON.parse((await AsyncStorage.getItem(historyKey(1))) ?? '[]');
    expect(saved[0].attachments).toEqual([image]);
    expect((await ChatHistoryStorage.loadAll()).histories[1][0]?.attachments).toEqual([image]);
  });

  test('OpenRouter gets image_url for images and file for PDFs', async () => {
    await ProviderSettings.setPriority(['openrouter']);
    // aiOrchestrator จำ lastGood ข้าม test — ปิด Gemini ให้ OpenRouter ตอบแน่ ๆ
    await ProviderSettings.setEnabled('gemini', false);
    const { calls } = mockFetch([[OPENROUTER, () => json({ choices: [{ message: { content: 'ok' } }] })]]);
    await sendMessage('สรุปให้หน่อย', { attachments: [image, pdf], speak: false });
    const last = (nth(calls, 0).body as { messages: { content: unknown }[] }).messages.at(-1);
    expect(last?.content).toEqual([
      { type: 'text', text: 'สรุปให้หน่อย' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,UklGRg==' } },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,UklGRg==' } },
    ]);
  });

  test('older attachments are sent as a short description only', async () => {
    await ProviderSettings.setPriority(['gemini']);
    useAtomStore.getState().pushMessage({ role: 'user', content: 'ดูรูป', attachments: [image] });
    useAtomStore.getState().pushMessage({ role: 'assistant', content: 'แมว' });
    const { calls } = mockFetch([[GEMINI, (c) => (isClassifierCall(c) ? geminiReply('{"intent":"chat","confidence":0.9}') : geminiReply('ok'))]]);
    await sendMessage('สีอะไร', { speak: false });
    const chat = calls.find((c) => !isClassifierCall(c));
    const contents = (chat?.body as { contents: { parts: { text?: string; inline_data?: unknown }[] }[] }).contents;
    expect(nth(contents, 0).parts).toEqual([{ text: 'ดูรูป\n[แนบรูป: cat.jpg]' }]);
  });

  test('a missing file shows a Thai notice and sends nothing', async () => {
    const { spy } = mockFetch([]);
    const res = await sendMessage('ดู', { attachments: [{ ...image, uri: 'file:///missing.jpg' }], speak: false });
    expect(res.error).toContain('ไม่พบไฟล์แนบ');
    expect(spy).not.toHaveBeenCalled();
    expect(useAtomStore.getState().messagesByPersona[1].at(-1)?.role).toBe('system');
  });
});

describe('UI', () => {
  test('plus → รูปภาพ adds a pending chip; send works without text', async () => {
    await ProviderSettings.setPriority(['gemini']);
    mockFetch([[GEMINI, () => geminiReply('รับรูปแล้ว')]]);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/dog.jpg', fileName: 'dog.jpg', mimeType: 'image/jpeg', fileSize: 1, width: 1, height: 1 }],
    });
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByLabelText('ช่องพิมพ์ข้อความ');
    await fireEvent.press(screen.getByLabelText('เพิ่ม'));
    await fireEvent.press(await screen.findByText('รูปภาพ'));
    await settle();
    expect(useAtomStore.getState().pendingAttachments).toHaveLength(1);
    expect(screen.getByLabelText('เอา dog.jpg ออก')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('ส่งข้อความ'));
    await settle();
    await settle();
    expect(useAtomStore.getState().pendingAttachments).toEqual([]);
    expect(useAtomStore.getState().messagesByPersona[1].map((m) => m.content)).toEqual(['', 'รับรูปแล้ว']);
  });

  test('picker errors become an Alert', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByLabelText('ช่องพิมพ์ข้อความ');
    await fireEvent.press(screen.getByLabelText('เพิ่ม'));
    await fireEvent.press(await screen.findByText('ถ่ายรูป'));
    await settle();
    expect(alert).toHaveBeenCalledWith('แนบไฟล์ไม่ได้', expect.stringContaining('กล้อง'));
  });
});

test('registry exposes chatStream on both LLM providers', () => {
  expect(typeof aiRegistry.get('gemini')?.chatStream).toBe('function');
  expect(typeof aiRegistry.get('openrouter')?.chatStream).toBe('function');
});
