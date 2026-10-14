import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Keyboard, TextInput, type KeyboardEvent, type View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { hasConfiguredLLM } from '../features/ai/core/keyStatus';
import { PERSONA_GREETINGS } from '../features/jarvis/constants';
import { useKeyboardOverlap } from '../features/jarvis/hooks/useKeyboardOverlap';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { RootNavigator } from '../navigation/RootNavigator';
import { GEMINI, geminiText, isClassifierCall, mockFetch } from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const NOTICE = 'ยังไม่ได้ตั้งค่า API key — ไปที่ ตั้งค่า › AI Providers';
const input = () => screen.getByLabelText('ช่องพิมพ์ข้อความ');
const sendButton = () => screen.getByLabelText('ส่งข้อความ');
const history = () => useAtomStore.getState().messagesByPersona[1];
/** Let async effects (key check, sendMessage) settle inside act(). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeAll(registerAll);

beforeEach(async () => {
  await resetSettings();
  await setAIKeys(['gemini', 'openrouter']);
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
  resetStore();
  useAtomStore.setState({ historyLoaded: true });
});

afterEach(() => jest.restoreAllMocks());

async function renderMain() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RootNavigator />
    </SafeAreaProvider>
  );
  await screen.findByLabelText('ช่องพิมพ์ข้อความ');
  await settle();
}

describe('MainScreen — chat input', () => {
  test('ChatInput is rendered with a placeholder for the active persona', async () => {
    await renderMain();
    expect(input()).toBeTruthy();
    expect(screen.getByPlaceholderText('พิมพ์ข้อความถึงอะตอม…')).toBeTruthy();
    await act(() => useAtomStore.getState().setActivePersona(3));
    expect(screen.getByPlaceholderText('พิมพ์ข้อความถึงไฟรเดย์…')).toBeTruthy();
  });

  test('⌨️ button focuses the input', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    await renderMain();
    await fireEvent.press(screen.getByLabelText('พิมพ์ข้อความ'));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test('focusing the input from idle switches to conversation mode', async () => {
    await renderMain();
    expect(useAtomStore.getState().uiMode).toBe('idle');
    await fireEvent(input(), 'focus');
    expect(useAtomStore.getState().uiMode).toBe('conversation');
  });

  test('typing + send → user message, real LLM reply (mocked Gemini), mood back to idle', async () => {
    const { calls } = mockFetch([
      [GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat","confidence":0.9}') : geminiText('สวัสดีครับบอส'))],
    ]);
    await renderMain();
    await fireEvent.changeText(input(), 'วันนี้เป็นไงบ้าง');
    await fireEvent.press(sendButton());
    await waitFor(() => expect(history().map((m) => [m.role, m.content])).toEqual([
      ['user', 'วันนี้เป็นไงบ้าง'],
      ['assistant', 'สวัสดีครับบอส'],
    ]));
    await settle();
    expect(input().props.value).toBe('');
    expect(useAtomStore.getState()).toMatchObject({ mood: 'idle', uiMode: 'conversation' });
    expect(await screen.findByText('สวัสดีครับบอส')).toBeTruthy();
    // the question itself reaches the LLM (not a canned reply)
    const chat = calls.filter((c) => !isClassifierCall(c));
    expect(JSON.stringify(chat.at(-1)?.body)).toContain('วันนี้เป็นไงบ้าง');
  });

  test('two different questions get two different answers', async () => {
    let n = 0;
    mockFetch([[GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat"}') : geminiText(`คำตอบที่ ${++n}`))]]);
    await renderMain();
    for (const q of ['คำถามแรก', 'คำถามที่สอง']) {
      await fireEvent.changeText(input(), q);
      await fireEvent.press(sendButton());
      await waitFor(() => expect(useAtomStore.getState().mood).toBe('idle'));
      await settle();
    }
    expect(history().filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual(['คำตอบที่ 1', 'คำตอบที่ 2']);
  });

  test('send is blocked while the assistant is thinking or speaking', async () => {
    const { spy } = mockFetch([]);
    await renderMain();
    await fireEvent.changeText(input(), 'ถามซ้อน');
    for (const mood of ['thinking', 'speaking'] as const) {
      await act(() => useAtomStore.getState().setMood(mood));
      expect(sendButton().props.accessibilityState?.disabled).toBe(true);
      await fireEvent.press(sendButton());
    }
    expect(spy).not.toHaveBeenCalled();
    expect(history()).toEqual([]);
    await act(() => useAtomStore.getState().setMood('idle'));
    expect(sendButton().props.accessibilityState?.disabled).toBe(false);
  });
});

describe('MainScreen — Orb (demo greeting removed)', () => {
  test('tapping the Orb enters conversation and focuses the input, without any canned message', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    await renderMain();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await fireEvent.press(screen.getByLabelText('แตะเพื่อเริ่มคุย'));
      await act(() => jest.advanceTimersByTimeAsync(6_000)); // the old demo pushed its greeting at 2.6s
      expect(useAtomStore.getState()).toMatchObject({ uiMode: 'conversation', mood: 'idle' });
      expect(focus).toHaveBeenCalled();
      expect(history()).toEqual([]);
      expect(screen.queryByText(PERSONA_GREETINGS[1])).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('tapping the small Orb in conversation goes back to idle and stops speech', async () => {
    const stop = jest.spyOn(voiceOrchestrator, 'stop');
    await renderMain();
    await act(() => useAtomStore.getState().setUIMode('conversation'));
    await fireEvent.press(screen.getByLabelText('กลับหน้าเลือกผู้ช่วย'));
    expect(useAtomStore.getState().uiMode).toBe('idle');
    expect(stop).toHaveBeenCalled();
    expect(history()).toEqual([]);
  });
});

describe('MainScreen — API key notice', () => {
  test('no LLM key → notice shown; tapping it opens AI Providers settings', async () => {
    await setAIKeys([]);
    await renderMain();
    await fireEvent.press(await screen.findByLabelText(NOTICE));
    expect(await screen.findByText('Advanced')).toBeTruthy(); // AISettingsScreen section
  });

  test('a configured LLM key → no notice', async () => {
    await renderMain();
    expect(screen.queryByLabelText(NOTICE)).toBeNull();
  });

  test('a key check that throws → logged, no false notice', async () => {
    jest.spyOn(SecureKeyStore, 'has').mockRejectedValue(new Error('keychain locked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderMain();
    expect(screen.queryByLabelText(NOTICE)).toBeNull();
    expect(error).toHaveBeenCalledWith('[chat] ตรวจสถานะ API key ไม่ได้', expect.any(Error));
  });
});

describe('hasConfiguredLLM', () => {
  test('true only for an enabled LLM provider that has a key (router providers like Jev do not count)', async () => {
    await setAIKeys([]);
    expect(await hasConfiguredLLM()).toBe(false);

    await SecureKeyStore.set(secretKey('ai', 'jev'), 'k');
    await ProviderSettings.setEnabled('jev', true);
    expect(await hasConfiguredLLM()).toBe(false);

    await SecureKeyStore.set(secretKey('ai', 'openrouter'), 'k');
    await ProviderSettings.setEnabled('openrouter', false);
    expect(await hasConfiguredLLM()).toBe(false);

    await ProviderSettings.setEnabled('openrouter', true);
    expect(await hasConfiguredLLM()).toBe(true);
  });
});

describe('useKeyboardOverlap', () => {
  test('overlap = container bottom − keyboard top (window coords); 0 when hidden or when the window already resized', async () => {
    const handlers: Record<string, (e: KeyboardEvent) => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: (e: KeyboardEvent) => void) => {
      handlers[event] = cb;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    let frame = { y: 47, height: 763 }; // safe-area container on an 844pt screen
    // Only measureInWindow is used by the hook; a full View instance isn't needed here
    const ref = { current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, frame.y, 390, frame.height) } as unknown as View };

    const { result } = await renderHook(() => useKeyboardOverlap(ref));
    const showEvent = Object.keys(handlers).find((k) => /Show|ChangeFrame/.test(k)) ?? '';
    const hideEvent = Object.keys(handlers).find((k) => /Hide/.test(k)) ?? '';
    const keyboard = (screenY: number, height: number) =>
      ({ endCoordinates: { screenX: 0, screenY, width: 390, height } }) as KeyboardEvent;

    expect(result.current.overlap).toBe(0);
    await act(() => handlers[showEvent]?.(keyboard(844 - 336, 336)));
    expect(result.current.overlap).toBe(47 + 763 - 508); // 302: keyboard minus the bottom inset

    frame = { y: 47, height: 508 - 47 }; // Android adjustResize: container shrank above the keyboard
    await act(() => result.current.onContainerLayout());
    expect(result.current.overlap).toBe(0);

    await act(() => handlers[hideEvent]?.(keyboard(844, 0)));
    expect(result.current.overlap).toBe(0);
  });
});
