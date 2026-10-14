import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { PersonaVoiceMapper } from '../features/settings/components/PersonaVoiceMapper';
import { PREVIEW_TEXT } from '../features/settings/components/voiceOptions';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { bytes, json, mockFetch } from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore } from '../test-utils/setup';
import { nth } from '../test-utils/nth';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const ELEVEN = /api\.elevenlabs\.io/;

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  await SecureKeyStore.delete(secretKey('tts', 'elevenlabs'));
  resetStore();
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

async function renderMapper() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PersonaVoiceMapper />
    </SafeAreaProvider>
  );
  await screen.findByText('ATOM');
}

/** Open a ModelSelector by its accessibility label and pick an option by its text. */
async function choose(selectorLabel: RegExp, optionText: string, index = 0) {
  await fireEvent.press(nth(screen.getAllByLabelText(selectorLabel), index));
  await fireEvent.press(await screen.findByText(optionText));
}

describe('ProviderSettings — persona voice map data', () => {
  test('per-persona voices resolve independently', async () => {
    await ProviderSettings.setTTSFor(2, { providerId: 'openai', voiceId: 'onyx', speed: 0.9 });
    await ProviderSettings.setTTSFor(3, { providerId: 'elevenlabs', voiceId: 'rachel' });
    await expect(ProviderSettings.resolveVoiceFor(1)).resolves.toEqual({ providerId: 'expo' });
    await expect(ProviderSettings.resolveVoiceFor(2)).resolves.toEqual({
      providerId: 'openai',
      voiceId: 'onyx',
      speed: 0.9,
    });
    await expect(ProviderSettings.resolveVoiceFor(3)).resolves.toMatchObject({ voiceId: 'rachel' });
  });

  test('"same voice for all" overrides every persona until switched off', async () => {
    await ProviderSettings.setTTSFor(2, { providerId: 'openai', voiceId: 'onyx' });
    await ProviderSettings.setSharedVoice({ providerId: 'azure', voiceId: 'th-TH-NiwatNeural' });
    await ProviderSettings.setSameVoiceForAll(true);
    for (const p of [1, 2, 3, 4] as const) {
      await expect(ProviderSettings.resolveVoiceFor(p)).resolves.toEqual({
        providerId: 'azure',
        voiceId: 'th-TH-NiwatNeural',
      });
    }
    await ProviderSettings.setSameVoiceForAll(false);
    await expect(ProviderSettings.resolveVoiceFor(2)).resolves.toMatchObject({ voiceId: 'onyx' });
  });

  test('mapping is written to AsyncStorage (survives restarts)', async () => {
    await ProviderSettings.setTTSFor(4, { providerId: 'polly', voiceId: 'Matthew' });
    const raw = JSON.parse((await AsyncStorage.getItem('atom.providerSettings.v1')) ?? '{}');
    expect(raw.ttsByPersona['4']).toEqual({ providerId: 'polly', voiceId: 'Matthew' });
    expect(raw.sameVoiceForAll).toBe(false);
  });

  test('VoiceOrchestrator speaks each persona with its mapped voice', async () => {
    await ProviderSettings.setTTSFor(2, { providerId: 'expo', voiceId: 'jarvis-voice', pitch: 0.8 });
    await ProviderSettings.setTTSFor(3, { providerId: 'expo', voiceId: 'friday-voice', speed: 1.3 });
    await voiceOrchestrator.speak('A', 2);
    await voiceOrchestrator.speak('B', 3);
    expect(Speech.speak).toHaveBeenNthCalledWith(1, 'A', expect.objectContaining({ voice: 'jarvis-voice', pitch: 0.8 }));
    expect(Speech.speak).toHaveBeenNthCalledWith(2, 'B', expect.objectContaining({ voice: 'friday-voice', rate: 1.3 }));
  });
});

describe('PersonaVoiceMapper UI', () => {
  test('renders the 4 personas with their saved provider and voice', async () => {
    await ProviderSettings.setTTSFor(4, { providerId: 'azure', voiceId: 'th-TH-NiwatNeural' });
    await renderMapper();
    for (const name of ['ATOM', 'JARVIS', 'FRIDAY', 'ULTRON']) expect(screen.getByText(name)).toBeTruthy();
    for (const name of ['อะตอม', 'จาร์วิส', 'ไฟรเดย์', 'อัลตรอน']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByLabelText('ผู้ให้บริการเสียง (TTS): Expo Speech')).toHaveLength(3);
    expect(screen.getByLabelText('ผู้ให้บริการเสียง (TTS): Azure Speech')).toBeTruthy();
    expect(screen.getByLabelText('เสียง: th-TH-NiwatNeural')).toBeTruthy();
  });

  test('changing a persona provider saves it and updates the active persona voice', async () => {
    await renderMapper();
    await choose(/^ผู้ให้บริการเสียง \(TTS\)/, 'ElevenLabs', 0); // ATOM row

    await waitFor(async () =>
      expect(await ProviderSettings.getTTSFor(1)).toEqual({ providerId: 'elevenlabs', voiceId: undefined })
    );
    await waitFor(() => expect(useAtomStore.getState().voice?.providerId).toBe('elevenlabs'));
    // other personas untouched
    await expect(ProviderSettings.getTTSFor(2)).resolves.toEqual({ providerId: 'expo' });
  });

  test('voice list loads from the provider (mocked ElevenLabs) and the pick is saved', async () => {
    await SecureKeyStore.set(secretKey('tts', 'elevenlabs'), 'el-key');
    await ProviderSettings.setTTSFor(2, { providerId: 'elevenlabs' });
    const { calls } = mockFetch([
      [
        ELEVEN,
        () =>
          json({
            voices: [
              { voice_id: 'v-adam', name: 'Adam', labels: { gender: 'male' } },
              { voice_id: 'v-bella', name: 'Bella', labels: { gender: 'female', language: 'th' } },
            ],
          }),
      ],
    ]);
    await renderMapper();

    // JARVIS row is the 2nd "เสียง" selector
    await fireEvent.press(nth(screen.getAllByLabelText(/^เสียง:/), 1));
    await fireEvent.press(screen.getByText('โหลดรายการ'));
    expect(await screen.findByText('Bella')).toBeTruthy();
    expect(screen.getByText('th · female')).toBeTruthy();
    expect(nth(calls, 0).headers['xi-api-key']).toBe('el-key');

    await fireEvent.press(screen.getByText('Bella'));
    await waitFor(async () =>
      expect(await ProviderSettings.getTTSFor(2)).toEqual({ providerId: 'elevenlabs', voiceId: 'v-bella' })
    );
  });

  test('voice list errors are shown inside the picker', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'elevenlabs' });
    await renderMapper();
    await fireEvent.press(nth(screen.getAllByLabelText(/^เสียง:/), 0));
    await fireEvent.press(screen.getByText('โหลดรายการ'));
    expect(await screen.findByText(/\[elevenlabs\] ยังไม่ได้ตั้งค่า API key/)).toBeTruthy();
  });

  test('preview speaks the sample with the row voice (Expo) / plays cloud audio (ElevenLabs)', async () => {
    await ProviderSettings.setTTSFor(1, { providerId: 'expo', voiceId: 'atom-voice' });
    await SecureKeyStore.set(secretKey('tts', 'elevenlabs'), 'el-key');
    await ProviderSettings.setTTSFor(2, { providerId: 'elevenlabs', voiceId: 'v-adam' });
    const { calls } = mockFetch([[ELEVEN, () => bytes()]]);
    await renderMapper();

    await fireEvent.press(nth(screen.getAllByText('ลองฟัง'), 0));
    expect(Speech.speak).toHaveBeenCalledWith(PREVIEW_TEXT, expect.objectContaining({ voice: 'atom-voice' }));

    jest.mocked(createAudioPlayer).mockImplementationOnce(() => {
      const listeners: ((s: { didJustFinish: boolean }) => void)[] = [];
      return {
        addListener: (_: string, fn: (s: { didJustFinish: boolean }) => void) => {
          listeners.push(fn);
          return { remove: jest.fn() };
        },
        play: () => listeners.forEach((fn) => fn({ didJustFinish: true })),
        pause: jest.fn(),
        remove: jest.fn(),
      } as never;
    });
    await fireEvent.press(nth(screen.getAllByText('ลองฟัง'), 1));
    await waitFor(() => expect(createAudioPlayer).toHaveBeenCalled());
    expect(nth(calls, 0).url.pathname).toBe('/v1/text-to-speech/v-adam');
  });

  test('preview failure is shown under the row', async () => {
    await ProviderSettings.setTTSFor(3, { providerId: 'elevenlabs' });
    await renderMapper();
    await fireEvent.press(nth(screen.getAllByText('ลองฟัง'), 2));
    expect(await screen.findByText(/\[elevenlabs\] ยังไม่ได้ตั้งค่า API key/)).toBeTruthy();
  });

  test('"ใช้ voice เดียวกันทุก persona" collapses to one shared row and applies to everyone', async () => {
    await renderMapper();
    await fireEvent(screen.getByLabelText('เปิดใช้ ใช้ voice เดียวกันทุก persona'), 'valueChange', true);

    expect(await screen.findByText('ทุก persona')).toBeTruthy();
    expect(screen.queryByText('ULTRON')).toBeNull();
    await choose(/^ผู้ให้บริการเสียง \(TTS\)/, 'Google Cloud TTS');

    await waitFor(async () =>
      expect(await ProviderSettings.resolveVoiceFor(3)).toEqual({ providerId: 'google', voiceId: undefined })
    );
    await expect(ProviderSettings.resolveVoiceFor(1)).resolves.toMatchObject({ providerId: 'google' });
    await waitFor(() => expect(useAtomStore.getState().voice?.providerId).toBe('google'));

    // switching persona keeps the shared voice
    useAtomStore.getState().setActivePersona(4);
    await waitFor(() => expect(useAtomStore.getState().voice?.providerId).toBe('google'));

    // off again → per-persona rows and voices come back
    await fireEvent(screen.getByLabelText('เปิดใช้ ใช้ voice เดียวกันทุก persona'), 'valueChange', false);
    expect(await screen.findByText('ULTRON')).toBeTruthy();
    await expect(ProviderSettings.resolveVoiceFor(4)).resolves.toEqual({ providerId: 'expo' });
  });

  test('provider picker lists all 8 TTS providers with key hints', async () => {
    await renderMapper();
    await fireEvent.press(nth(screen.getAllByLabelText(/^ผู้ให้บริการเสียง \(TTS\)/), 0));
    for (const name of ['OpenAI TTS', 'Amazon Polly', 'Play.ht', 'Custom (OpenAI-compatible)']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText('บนเครื่อง · ไม่ต้องใช้ key')).toBeTruthy();
    expect(screen.getAllByText('ต้องใช้ API key')).toHaveLength(7);
  });
});
