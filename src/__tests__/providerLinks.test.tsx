import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import { ApiKeyInput } from '../features/settings/components/ApiKeyInput';
import { PROVIDER_KEY_URLS, keyUrlFor } from '../features/settings/constants/providerLinks';
import { AISettingsScreen } from '../features/settings/screens/AISettingsScreen';
import { VoiceSettingsScreen } from '../features/settings/screens/VoiceSettingsScreen';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const LINK_TEXT = '🔗 สร้าง API Key';
const links = () => screen.queryAllByRole('link', { name: 'สร้าง API Key' });

let openURL: jest.SpyInstance;

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await SecureKeyStore.delete('test.key');
  // Linking.openURL is already a jest.fn in the RN preset: spyOn returns that same mock, so clear its history
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  openURL.mockClear();
});

afterEach(() => jest.restoreAllMocks());

/** Press every "สร้าง API Key" link on screen and return the URLs opened, in order. */
async function pressAllLinks(): Promise<string[]> {
  for (const link of links()) await fireEvent.press(link);
  return openURL.mock.calls.map((c: unknown[]) => String(c[0]));
}

describe('keyUrlFor', () => {
  test.each([
    ['ai', 'gemini', 'https://aistudio.google.com/apikey'],
    ['ai', 'openrouter', 'https://openrouter.ai/keys'],
    ['tts', 'gemini', 'https://aistudio.google.com/apikey'], // shares the Gemini LLM key
    ['tts', 'google', 'https://console.cloud.google.com/apis/credentials'],
    ['tts', 'openai', 'https://platform.openai.com/api-keys'],
    ['tts', 'elevenlabs', 'https://elevenlabs.io/app/settings/api-keys'],
    ['tts', 'azure', 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices'],
    ['tts', 'polly', 'https://console.aws.amazon.com/iam/home#/security_credentials'],
    ['stt', 'whisper', 'https://platform.openai.com/api-keys'], // Whisper uses an OpenAI key
    ['stt', 'google', 'https://console.cloud.google.com/apis/credentials'],
    ['stt', 'azure', 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices'],
  ] as const)('%s.%s → %s', (scope, id, url) => {
    expect(keyUrlFor(scope, id)).toBe(url);
  });

  test.each([
    ['tts', 'expo'], // on-device, no key
    ['stt', 'expo'],
    ['ai', 'custom'], // PROVIDER_KEY_URLS.custom = null
    ['tts', 'custom'],
    ['stt', 'custom'],
    ['ai', 'jev'], // not in the map
    ['tts', 'nope'],
  ] as const)('%s.%s → no link', (scope, id) => {
    expect(keyUrlFor(scope, id)).toBeUndefined();
  });

  test('every URL in the map is https (or null)', () => {
    for (const url of Object.values(PROVIDER_KEY_URLS)) {
      if (url !== null) expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe('ApiKeyInput link', () => {
  test('renders "🔗 สร้าง API Key" as an accessible link when a URL is given; press → Linking.openURL(url)', async () => {
    await render(<ApiKeyInput storageKey="test.key" keyUrl="https://openrouter.ai/keys" />);
    const link = screen.getByRole('link', { name: 'สร้าง API Key' });
    expect(screen.getByText(LINK_TEXT)).toBeTruthy();
    expect(link.props.accessibilityHint).toBe('เปิด openrouter.ai ในเบราว์เซอร์');
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://openrouter.ai/keys');
  });

  test('no URL → no link', async () => {
    await render(<ApiKeyInput storageKey="test.key" />);
    expect(screen.queryByText(LINK_TEXT)).toBeNull();
    expect(links()).toHaveLength(0);
  });

  test('link stays available after a key is saved (to rotate it)', async () => {
    await render(<ApiKeyInput storageKey="test.key" keyUrl="https://openrouter.ai/keys" />);
    await fireEvent.changeText(screen.getByLabelText('API key'), 'sk-or-123');
    await fireEvent.press(screen.getByText('บันทึก'));
    expect(await screen.findByLabelText('API key บันทึกแล้ว')).toBeTruthy();
    expect(links()).toHaveLength(1);
  });

  test('a URL that cannot be opened is logged, never thrown', async () => {
    openURL.mockRejectedValueOnce(new Error('No Activity found to handle Intent'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await render(<ApiKeyInput storageKey="test.key" keyUrl="https://elevenlabs.io/app/settings/api-keys" />);
    await fireEvent.press(screen.getByRole('link', { name: 'สร้าง API Key' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith('[settings] เปิดลิงก์สร้าง API key ไม่ได้', expect.any(Error));
  });
});

describe('Settings screens', () => {
  const renderInSafeArea = (node: React.ReactElement) =>
    render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

  test('AI Providers: Gemini + OpenRouter get links, Jev does not', async () => {
    await renderInSafeArea(<AISettingsScreen />);
    await screen.findByText('Advanced');
    expect(links()).toHaveLength(2);
    expect(await pressAllLinks()).toEqual(['https://aistudio.google.com/apikey', 'https://openrouter.ai/keys']);
  });

  test('Voice: links for Gemini, OpenAI, ElevenLabs, Google, Azure, Polly (TTS) and Whisper, Google, Azure (STT)', async () => {
    await renderInSafeArea(<VoiceSettingsScreen />);
    await screen.findByText('TTS Priority');
    expect(await pressAllLinks()).toEqual([
      'https://aistudio.google.com/apikey', // Gemini TTS
      'https://platform.openai.com/api-keys', // OpenAI TTS
      'https://elevenlabs.io/app/settings/api-keys',
      'https://console.cloud.google.com/apis/credentials', // Google Cloud TTS
      'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices', // Azure TTS
      'https://console.aws.amazon.com/iam/home#/security_credentials', // Polly
      'https://platform.openai.com/api-keys', // Whisper
      'https://console.cloud.google.com/apis/credentials', // Google STT
      'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices', // Azure STT
    ]);
    // Expo Speech, Play.ht and Custom cards have no link: 9 links for 15 key fields
    expect(screen.getAllByLabelText('API key')).toHaveLength(15);
    expect(nth(links(), 0).props.accessibilityHint).toBe('เปิด aistudio.google.com ในเบราว์เซอร์');
  });
});
