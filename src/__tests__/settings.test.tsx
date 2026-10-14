import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { registerAIProviders } from '../features/ai';
import { registerVoiceProviders } from '../features/voice';
import { RootNavigator } from '../navigation/RootNavigator';
import { nth } from '../test-utils/nth';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

beforeAll(() => {
  registerAIProviders();
  registerVoiceProviders();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openSettings(entry?: string) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RootNavigator />
    </SafeAreaProvider>
  );
  // Header ⚙️ on the main screen opens the settings hub
  await fireEvent.press(await screen.findByLabelText('ตั้งค่า'));
  expect(await screen.findByText('Persona Voice Map')).toBeTruthy();
  if (entry) await fireEvent.press(screen.getByLabelText(entry));
}

test('settings hub lists the three entries', async () => {
  await openSettings();
  expect(screen.getByText('AI Providers')).toBeTruthy();
  expect(screen.getByText('Voice (TTS + STT)')).toBeTruthy();
  expect(screen.getByText('Persona Voice Map')).toBeTruthy();
});

test('AI settings: cards, key save, test connection, toggle, priority', async () => {
  await openSettings('AI Providers');
  // Each LLM provider appears on its card and in the priority list
  expect(await screen.findAllByText('Google Gemini')).toHaveLength(2);
  expect(screen.getAllByText('OpenRouter')).toHaveLength(2);
  expect(screen.getByText('Jev (TypeSafe)')).toBeTruthy();
  expect(screen.getByText('Advanced')).toBeTruthy();

  // No key yet → test reports the missing key without touching the network
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  await fireEvent.press(nth(screen.getAllByText('ทดสอบการเชื่อมต่อ'), 0));
  expect(await screen.findByText(/\[gemini\] ยังไม่ได้ตั้งค่า API key/)).toBeTruthy();
  expect(fetchSpy).not.toHaveBeenCalled();

  // Save a key → stored in SecureStore, UI only shows that one exists
  await fireEvent.changeText(nth(screen.getAllByLabelText('API key'), 0), 'test-key');
  await fireEvent.press(nth(screen.getAllByText('บันทึก'), 0));
  expect(await screen.findByLabelText('API key บันทึกแล้ว')).toBeTruthy();
  expect(await SecureKeyStore.get('ai.gemini')).toBe('test-key');

  // Test connection with the key against a mocked endpoint
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ models: [] })));
  await fireEvent.press(nth(screen.getAllByText('ทดสอบการเชื่อมต่อ'), 0));
  expect(await screen.findByText('✓ เชื่อมต่อได้')).toBeTruthy();
  expect(String(nth(fetchSpy.mock.calls, 0)[0])).toContain('generativelanguage.googleapis.com');

  // Toggle Gemini off
  await fireEvent(screen.getByLabelText('เปิดใช้ Google Gemini'), 'valueChange', false);
  await waitFor(async () => expect(await ProviderSettings.getEnabled('gemini')).toBe(false));

  // Move OpenRouter above Gemini
  await fireEvent.press(screen.getByLabelText('เลื่อน OpenRouter ขึ้น'));
  await waitFor(async () =>
    expect(await ProviderSettings.getPriority()).toEqual(['openrouter', 'gemini'])
  );

  // Advanced: retries +1
  await fireEvent.press(screen.getByLabelText('เพิ่มจำนวน retry'));
  await waitFor(async () => expect((await ProviderSettings.getAdvanced()).retries).toBe(1));
});

test('Voice settings: 8 TTS + 8 STT providers and both priority lists', async () => {
  await openSettings('Voice (TTS + STT)');
  // Card + TTS priority row
  expect(await screen.findAllByText('ElevenLabs')).toHaveLength(2);
  expect(screen.getAllByText('ทดสอบการเชื่อมต่อ')).toHaveLength(16);
  expect(screen.getByText('TTS Priority')).toBeTruthy();
  expect(screen.getByText('STT Priority')).toBeTruthy();
  // Azure needs a region field in both sections
  expect(screen.getAllByLabelText('Region').length).toBeGreaterThanOrEqual(2);

  // On-device STT test reports it's unavailable
  const stt = nth(screen.getAllByText('ทดสอบการเชื่อมต่อ'), 8);
  await fireEvent.press(stt);
  expect(await screen.findByText(/\[expo\] ยังไม่รองรับการถอดเสียงบนเครื่อง/)).toBeTruthy();
});

test('Persona voice map: per-persona rows and the shared-voice toggle', async () => {
  await openSettings('Persona Voice Map');
  for (const name of ['ATOM', 'JARVIS', 'FRIDAY', 'ULTRON']) {
    expect(await screen.findByText(name)).toBeTruthy();
  }
  await fireEvent(screen.getByLabelText('เปิดใช้ ใช้ voice เดียวกันทุก persona'), 'valueChange', true);
  expect(await screen.findByText('ทุก persona')).toBeTruthy();
  expect(screen.queryByText('ATOM')).toBeNull();
  await waitFor(async () => expect(await ProviderSettings.getSameVoiceForAll()).toBe(true));
});
