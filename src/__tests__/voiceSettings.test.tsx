import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { PREVIEW_TEXT } from '../features/settings/components/voiceOptions';
import { VoiceSettingsScreen } from '../features/settings/screens/VoiceSettingsScreen';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { STT_PROVIDERS, TTS_PROVIDERS } from '../features/voice/voice.config';
import { json, mockFetch } from '../test-utils/mockFetch';
import { registerAll, resetSettings } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  for (const p of [...TTS_PROVIDERS]) await SecureKeyStore.delete(secretKey('tts', p.id));
  for (const p of [...STT_PROVIDERS]) await SecureKeyStore.delete(secretKey('stt', p.id));
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <VoiceSettingsScreen />
    </SafeAreaProvider>
  );
  await screen.findByText('TTS Priority');
}

/** Type into a secret field and press the Save button that belongs to it. */
async function saveSecret(label: string, value: string, index = 0) {
  const fields = screen.getAllByLabelText(/^(API key|Access key ID|User ID)$/);
  const target = nth(screen.getAllByLabelText(label), index);
  await fireEvent.changeText(target, value);
  await fireEvent.press(nth(screen.getAllByText('บันทึก'), fields.indexOf(target)));
}

/**
 * Minimal responder event for PanResponder: it derives gestureState (dy) from touchHistory.
 */
function touch(pageY: number, timestamp: number, active = true, previousPageY = pageY) {
  const t = { touchActive: active, startPageX: 0, startPageY: 100, startTimeStamp: 0,
    currentPageX: 0, currentPageY: pageY, currentTimeStamp: timestamp,
    previousPageX: 0, previousPageY, previousTimeStamp: timestamp - 1 };
  return {
    nativeEvent: { touches: active ? [{ pageX: 0, pageY }] : [], changedTouches: [{ pageX: 0, pageY }], pageX: 0, pageY, timestamp },
    touchHistory: { numberActiveTouches: active ? 1 : 0, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: timestamp, touchBank: [t] },
  };
}

const rowOrder = () =>
  screen
    .getAllByLabelText(/^ลำดับ \d+: /)
    .map((el) => String(el.props.accessibilityLabel).replace(/^ลำดับ \d+: /, ''));

describe('Voice settings screen — layout', () => {
  test('one card per provider: 9 TTS + 8 STT, each with a connection test', async () => {
    await renderScreen();
    expect(screen.getByText('TTS — เสียงพูด')).toBeTruthy();
    expect(screen.getByText('STT — ถอดเสียง')).toBeTruthy();
    expect(screen.getAllByText('ทดสอบการเชื่อมต่อ')).toHaveLength(17);
    // 9 + 8 toggles (Azure appears in both sections)
    for (const p of TTS_PROVIDERS) expect(screen.getAllByLabelText(`เปิดใช้ ${p.name}`).length).toBeGreaterThan(0);
    for (const p of STT_PROVIDERS) expect(screen.getAllByLabelText(`เปิดใช้ ${p.name}`).length).toBeGreaterThan(0);
    // + สวิตช์ "พูดแทรกได้" ของโหมดคุยด้วยเสียง
    expect(screen.getAllByRole('switch')).toHaveLength(18);
    // keyless on-device providers don't ask for a key: 8 TTS + 7 STT key fields
    expect(screen.getAllByLabelText('API key')).toHaveLength(15);
    // Gemini TTS can share the Gemini LLM key — its field says so
    expect(screen.getByPlaceholderText('ว่างไว้ = ใช้ key ของ Gemini (AI Providers)')).toBeTruthy();
    // TTS cards have a default-voice picker and a preview button
    expect(screen.getAllByLabelText(/^เสียงเริ่มต้น:/)).toHaveLength(9);
    expect(screen.getAllByText('ลองฟัง')).toHaveLength(9);
  });

  test('provider-specific extra fields are rendered', async () => {
    await renderScreen();
    expect(screen.getAllByLabelText('Region')).toHaveLength(3); // Azure TTS, Polly, Azure STT
    expect(screen.getByLabelText('Access key ID')).toBeTruthy(); // Polly
    expect(screen.getByLabelText('User ID')).toBeTruthy(); // Play.ht
    expect(screen.getAllByLabelText('Base URL')).toHaveLength(2); // Custom TTS + STT
    expect(screen.getAllByLabelText('Model')).toHaveLength(3); // Gemini TTS + Custom TTS + STT
    expect(screen.getByText('ค่าเริ่มต้น · ไม่ต้องใช้ key')).toBeTruthy();
    expect(screen.getByText('บนเครื่อง · ยังไม่รองรับ (ต้องใช้ development build)')).toBeTruthy();
  });

  test('priority lists start from the saved order, then the remaining providers', async () => {
    await ProviderSettings.setVoicePriority('tts', ['playht', 'expo']);
    await ProviderSettings.setVoicePriority('stt', ['deepgram']);
    await renderScreen();
    await waitFor(() => expect(rowOrder()[0]).toBe('Play.ht'));
    const order = rowOrder();
    expect(order.slice(0, 9)).toEqual([
      'Play.ht', 'Expo Speech', 'Gemini TTS', 'OpenAI TTS', 'ElevenLabs', 'Google Cloud TTS', 'Azure Speech',
      'Amazon Polly', 'Custom (OpenAI-compatible)',
    ]);
    expect(order.slice(9)).toEqual([
      'Deepgram', 'ถอดเสียงในเครื่อง', 'OpenAI Whisper', 'Google Cloud STT', 'Azure Speech', 'AssemblyAI',
      'Rev AI', 'Custom',
    ]);
  });
});

describe('Voice settings screen — interactions', () => {
  test('toggling TTS/STT providers saves the enabled flag', async () => {
    await renderScreen();
    await fireEvent(screen.getByLabelText('เปิดใช้ ElevenLabs'), 'valueChange', false);
    await fireEvent(screen.getByLabelText('เปิดใช้ Deepgram'), 'valueChange', false);
    await waitFor(async () => {
      expect(await ProviderSettings.getVoiceEnabled('tts', 'elevenlabs')).toBe(false);
      expect(await ProviderSettings.getVoiceEnabled('stt', 'deepgram')).toBe(false);
    });
    expect(await ProviderSettings.getVoiceEnabled('tts', 'openai')).toBe(true);
  });

  test('saving a TTS key stores it in SecureStore (scoped tts.*), never in AsyncStorage', async () => {
    await renderScreen();
    // key fields: Gemini TTS, then OpenAI TTS (Expo Speech has none)
    await saveSecret('API key', 'sk-tts-123', 1);
    expect(await screen.findByLabelText('API key บันทึกแล้ว')).toBeTruthy();
    expect(await SecureKeyStore.get(secretKey('tts', 'openai'))).toBe('sk-tts-123');
    expect(await SecureKeyStore.get(secretKey('stt', 'whisper'))).toBeNull();
    const asyncStorageDump = JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()));
    expect(asyncStorageDump).not.toContain('sk-tts-123');

    // edit → cancel keeps it, delete removes it
    await fireEvent.press(screen.getByText('แก้ไข'));
    await fireEvent.press(screen.getByText('ยกเลิก'));
    await fireEvent.press(screen.getByText('ลบ'));
    await waitFor(async () => expect(await SecureKeyStore.has(secretKey('tts', 'openai'))).toBe(false));
  });

  test('extra fields: Polly access key → SecureStore, region/base URL → settings options', async () => {
    await renderScreen();
    await saveSecret('Access key ID', 'AKIA-TEST');
    await waitFor(async () =>
      expect(await SecureKeyStore.get(secretKey('tts', 'polly', 'accessKeyId'))).toBe('AKIA-TEST')
    );

    const pollyRegion = nth(screen.getAllByLabelText('Region'), 1);
    await fireEvent.changeText(pollyRegion, ' ap-southeast-1 ');
    await fireEvent(pollyRegion, 'endEditing');
    const customUrl = nth(screen.getAllByLabelText('Base URL'), 0);
    await fireEvent.changeText(customUrl, 'http://192.168.1.10:8000/v1');
    await fireEvent(customUrl, 'endEditing');
    await waitFor(async () => {
      expect(await ProviderSettings.getOption('tts.polly', 'region')).toBe('ap-southeast-1');
      expect(await ProviderSettings.getOption('tts.custom', 'baseURL')).toBe('http://192.168.1.10:8000/v1');
    });
  });

  test('default voice picker loads the device voices and saves the choice', async () => {
    await renderScreen();
    await fireEvent.press(nth(screen.getAllByLabelText(/^เสียงเริ่มต้น:/), 0)); // Expo Speech
    await fireEvent.press(screen.getByText('โหลดรายการ'));
    await fireEvent.press(await screen.findByText('Kanya'));
    await waitFor(async () =>
      expect(await ProviderSettings.getOption('tts.expo', 'voiceId')).toBe('th-TH-voice')
    );
    expect(screen.getByLabelText('เสียงเริ่มต้น: Kanya')).toBeTruthy();
  });

  test('the saved default voice is used when that provider speaks as a fallback', async () => {
    await ProviderSettings.setOption('tts.expo', 'voiceId', 'fallback-voice');
    await ProviderSettings.setTTSFor(1, { providerId: 'openai' }); // no key → falls back
    await voiceOrchestrator.speak('hi', 1);
    expect(Speech.speak).toHaveBeenCalledWith('hi', expect.objectContaining({ voice: 'fallback-voice' }));
  });

  test('preview: Expo speaks the sample; a keyless cloud provider shows the error', async () => {
    await renderScreen();
    await fireEvent.press(nth(screen.getAllByText('ลองฟัง'), 0));
    expect(Speech.speak).toHaveBeenCalledWith(PREVIEW_TEXT, expect.objectContaining({ language: 'th-TH' }));

    await fireEvent.press(nth(screen.getAllByText('ลองฟัง'), 2)); // OpenAI TTS, no key
    expect(await screen.findByText(/\[openai\] ยังไม่ได้ตั้งค่า API key/)).toBeTruthy();
  });

  test('test connection: TTS ok with a key (mocked OpenAI), STT reports missing key', async () => {
    await SecureKeyStore.set(secretKey('tts', 'openai'), 'sk');
    const { calls } = mockFetch([[/api\.openai\.com/, () => json({ data: [] })]]);
    await renderScreen();

    await fireEvent.press(nth(screen.getAllByText('ทดสอบการเชื่อมต่อ'), 2)); // OpenAI TTS
    expect(await screen.findByText('✓ เชื่อมต่อได้')).toBeTruthy();
    expect(nth(calls, 0).headers.Authorization).toBe('Bearer sk');

    await fireEvent.press(nth(screen.getAllByText('ทดสอบการเชื่อมต่อ'), 10)); // Whisper
    expect(await screen.findByText('[whisper] ยังไม่ได้ตั้งค่า API key')).toBeTruthy();
  });

  test('TTS / STT priority: ↑↓ buttons reorder and persist', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('เลื่อน Gemini TTS ขึ้น'));
    await waitFor(async () =>
      expect((await ProviderSettings.getVoicePriority('tts')).slice(0, 2)).toEqual(['gemini', 'expo'])
    );

    await fireEvent.press(screen.getByLabelText('เลื่อน ถอดเสียงในเครื่อง ลง'));
    await waitFor(async () =>
      expect((await ProviderSettings.getVoicePriority('stt')).slice(0, 2)).toEqual(['whisper', 'expo'])
    );
    // boundaries are disabled
    expect(screen.getByLabelText('เลื่อน Gemini TTS ขึ้น').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('เลื่อน Custom ลง').props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('TTS priority: dragging a row by its handle moves it and persists the order', async () => {
    await renderScreen();
    const handle = screen.getByLabelText('ลาก Google Cloud TTS เพื่อจัดลำดับ'); // row 5
    await fireEvent(handle, 'responderGrant', touch(100, 1));
    // row 5 → row 1: up 4 rows (64px stride)
    await fireEvent(handle, 'responderMove', touch(100 - 4 * 64, 2, true, 100));
    expect(screen.getByLabelText('ลำดับ 5: Google Cloud TTS')).toBeTruthy(); // not committed yet
    await fireEvent(handle, 'responderRelease', touch(100 - 4 * 64, 3, false));
    await waitFor(async () =>
      expect((await ProviderSettings.getVoicePriority('tts')).slice(0, 3)).toEqual(['google', 'expo', 'gemini'])
    );
    expect(rowOrder().slice(0, 3)).toEqual(['Google Cloud TTS', 'Expo Speech', 'Gemini TTS']);
  });

  test('a cancelled drag (responder terminated) changes nothing', async () => {
    await renderScreen();
    const handle = screen.getByLabelText('ลาก ElevenLabs เพื่อจัดลำดับ');
    await fireEvent(handle, 'responderGrant', touch(100, 1));
    await fireEvent(handle, 'responderMove', touch(300, 2, true, 100));
    expect(screen.getByLabelText('ลำดับ 4: ElevenLabs')).toBeTruthy();
    await fireEvent(handle, 'responderTerminate', touch(300, 3, false));
    expect(await ProviderSettings.getVoicePriority('tts')).toEqual([]);
  });
});
