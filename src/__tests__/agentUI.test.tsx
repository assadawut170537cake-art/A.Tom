import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { agentRegistry, AgentRegistry } from '../core/agents/AgentRegistry';
import { AgentErrorBoundary } from '../core/agents/components/AgentErrorBoundary';
import type { AgentDefinition, AgentScreenComponent, AgentScreenProps } from '../core/agents/types';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { AgentHost } from '../features/agents/components/AgentHost';
import { AgentScreen } from '../features/agents/screens/AgentScreen';
import { useAgentPanelStore } from '../features/agents/stores/useAgentPanelStore';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { NoteAgentScreen } from '../modules/agents/NoteAgentScreen';
import { NoteStore } from '../modules/agents/noteStore';
import { createNoteAgent, NOTE_AGENT_ID } from '../modules/agents/sample-agent';
import { RootNavigator } from '../navigation/RootNavigator';
import type { RootScreenProps } from '../navigation/types';
import { GEMINI, geminiText, isClassifierCall, mockFetch } from '../test-utils/mockFetch';
import { registerAll, resetSettings, resetStore, setAIKeys } from '../test-utils/setup';

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

function agentWithScreen(Screen: AgentScreenComponent, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'demo',
    name: 'เดโม',
    capabilities: [],
    run: async () => ({ reply: 'ok' }),
    loadScreen: async () => Screen,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('AgentErrorBoundary', () => {
  test('catches a crashing agent UI, shows Thai fallback, retry re-mounts', async () => {
    let crash = true;
    const Flaky = () => {
      if (crash) throw new Error('แตก sk-secret123');
      return <Text>หายแล้ว</Text>;
    };
    const onRetry = jest.fn();
    await render(
      <AgentErrorBoundary agentName="โน้ต" onRetry={onRetry}>
        <Flaky />
      </AgentErrorBoundary>
    );
    expect(screen.getByText('หน้าจอของ โน้ต มีปัญหา')).toBeTruthy();
    expect(screen.getByText('แตก [REDACTED]')).toBeTruthy();

    crash = false;
    await fireEvent.press(screen.getByLabelText('ลองใหม่'));
    expect(screen.getByText('หายแล้ว')).toBeTruthy();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('renders children untouched when nothing throws', async () => {
    await render(
      <AgentErrorBoundary>
        <Text>ปกติ</Text>
      </AgentErrorBoundary>
    );
    expect(screen.getByText('ปกติ')).toBeTruthy();
    expect(screen.queryByLabelText('ลองใหม่')).toBeNull();
  });
});

describe('AgentHost', () => {
  test('lazy-loads the agent screen and passes agentId + onClose', async () => {
    const registry = new AgentRegistry();
    const onClose = jest.fn();
    const Screen = ({ agentId, onClose: close }: AgentScreenProps) => (
      <Text onPress={close}>{`หน้าจอ ${agentId}`}</Text>
    );
    registry.register(agentWithScreen(Screen));
    await render(<AgentHost agentId="demo" onClose={onClose} registry={registry} />);
    await fireEvent.press(await screen.findByText('หน้าจอ demo'));
    expect(onClose).toHaveBeenCalled();
  });

  test('load failure → Thai message + retry loads again', async () => {
    const registry = new AgentRegistry();
    const loadScreen = jest
      .fn<Promise<AgentScreenComponent>, []>()
      .mockRejectedValueOnce(new Error('โหลด chunk ไม่ได้'))
      .mockResolvedValue(() => <Text>โหลดได้แล้ว</Text>);
    registry.register(agentWithScreen(() => null, { loadScreen }));
    await render(<AgentHost agentId="demo" onClose={jest.fn()} registry={registry} />);
    expect(await screen.findByText('โหลดหน้าจอของ เดโม ไม่สำเร็จ')).toBeTruthy();
    expect(screen.getByText('โหลด chunk ไม่ได้')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('ลองใหม่'));
    expect(await screen.findByText('โหลดได้แล้ว')).toBeTruthy();
  });

  test('a crash inside the loaded screen is contained by the error boundary', async () => {
    const registry = new AgentRegistry();
    const Boom = () => {
      throw new Error('UI พัง');
    };
    registry.register(agentWithScreen(Boom));
    await render(<AgentHost agentId="demo" onClose={jest.fn()} registry={registry} />);
    expect(await screen.findByText('หน้าจอของ เดโม มีปัญหา')).toBeTruthy();
  });

  test('agent without a screen → Thai notice', async () => {
    const registry = new AgentRegistry();
    registry.register(agentWithScreen(() => null, { loadScreen: undefined }));
    await render(<AgentHost agentId="demo" onClose={jest.fn()} registry={registry} />);
    expect(await screen.findByText('เดโม ไม่มีหน้าจอให้แสดง')).toBeTruthy();
  });
});

describe('AgentScreen (route)', () => {
  const props = (agentId: string) => {
    const navigation = { setOptions: jest.fn(), goBack: jest.fn() };
    // the screen only touches setOptions/goBack; a full navigation object isn't needed for this unit test
    const p = { navigation, route: { key: 'Agent-1', name: 'Agent', params: { agentId } } } as unknown as RootScreenProps<'Agent'>;
    return { p, navigation };
  };

  test('renders the agent UI and titles the header with its name', async () => {
    const registry = new AgentRegistry();
    registry.register(agentWithScreen(({ onClose }) => <Text onPress={onClose}>เนื้อหาเดโม</Text>));
    const { p, navigation } = props('demo');
    await render(<AgentScreen {...p} registry={registry} />);
    await fireEvent.press(await screen.findByText('เนื้อหาเดโม'));
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'เดโม' });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('unknown agent → Thai not-found message', async () => {
    const { p } = props('ghost');
    await render(<AgentScreen {...p} registry={new AgentRegistry()} />);
    expect(screen.getByText('ไม่พบผู้ช่วย "ghost" — อาจถูกถอดออกไปแล้ว')).toBeTruthy();
  });
});

describe('NoteAgentScreen', () => {
  test('lists notes, updates live, deletes', async () => {
    const store = new NoteStore();
    await render(<NoteAgentScreen agentId="note" onClose={jest.fn()} store={store} />);
    expect(await screen.findByText('ยังไม่มีโน้ต — ลองพิมพ์ “จดบันทึกว่า …”')).toBeTruthy();
    await act(async () => {
      await store.add('ซื้อนม');
    });
    expect(screen.getByText('ซื้อนม')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('ลบโน้ต ซื้อนม'));
    await waitFor(() => expect(screen.queryByText('ซื้อนม')).toBeNull());
  });
});

describe('MainScreen — Agent Panel', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  const input = () => screen.getByLabelText('ช่องพิมพ์ข้อความ');
  const send = async (text: string) => {
    await fireEvent.changeText(input(), text);
    await fireEvent.press(screen.getByLabelText('ส่งข้อความ'));
    await waitFor(() => expect(useAtomStore.getState().mood).toBe('idle'));
    await settle();
  };
  const history = () => useAtomStore.getState().messagesByPersona[1].map((m) => [m.role, m.content]);

  beforeAll(registerAll);

  beforeEach(async () => {
    await resetSettings();
    await setAIKeys(['gemini', 'openrouter']);
    for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setTTSFor(p, { providerId: 'expo' });
    resetStore();
    useAtomStore.setState({ historyLoaded: true });
    useAgentPanelStore.getState().close();
    // fresh store per test; the screen is imported statically because jest can't run import()
    const store = new NoteStore();
    agentRegistry.clear();
    agentRegistry.register({
      ...createNoteAgent(store),
      loadScreen: async () => (p: AgentScreenProps) => <NoteAgentScreen {...p} store={store} />,
    });
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByLabelText('ช่องพิมพ์ข้อความ');
    await settle();
  });

  afterAll(() => agentRegistry.clear());

  test('"จดบันทึกว่า …" opens the panel with the note — no LLM call; close hides it', async () => {
    const { spy } = mockFetch([]);
    await send('จดบันทึกว่า ซื้อนม');
    expect(spy).not.toHaveBeenCalled();
    expect(history()).toEqual([
      ['user', 'จดบันทึกว่า ซื้อนม'],
      ['assistant', 'จดแล้วครับบอส: “ซื้อนม”'],
    ]);
    expect(useAgentPanelStore.getState().agentId).toBe(NOTE_AGENT_ID);
    expect(screen.getByLabelText('แผง โน้ต')).toBeTruthy();
    expect(await screen.findByText('ซื้อนม')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('ปิด โน้ต'));
    expect(screen.queryByLabelText('แผง โน้ต')).toBeNull();
  });

  test('a bad command → Thai error reply and no panel', async () => {
    mockFetch([]);
    await send('จดบันทึกว่า');
    const last = history().at(-1);
    expect(last?.[0]).toBe('assistant');
    expect(last?.[1]).toContain('โน้ตทำงานไม่สำเร็จครับ — ยังไม่ได้บอกว่าจะจดอะไร');
    expect(screen.queryByLabelText('แผง โน้ต')).toBeNull();
  });

  test('normal chat still goes through the LLM and opens no panel', async () => {
    mockFetch([[GEMINI, (c) => (isClassifierCall(c) ? geminiText('{"intent":"chat","confidence":0.9}') : geminiText('สบายดีครับ'))]]);
    await send('วันนี้เป็นไงบ้าง');
    expect(history()).toEqual([
      ['user', 'วันนี้เป็นไงบ้าง'],
      ['assistant', 'สบายดีครับ'],
    ]);
    expect(screen.queryByLabelText('แผง โน้ต')).toBeNull();
  });

  test('expand opens the full-screen Agent route and closes the panel', async () => {
    mockFetch([]);
    await send('ดูโน้ต');
    await fireEvent.press(screen.getByLabelText('เปิด โน้ต เต็มจอ'));
    await settle();
    expect(useAgentPanelStore.getState().agentId).toBeNull();
    expect(await screen.findByText('ยังไม่มีโน้ต — ลองพิมพ์ “จดบันทึกว่า …”')).toBeTruthy();
  });

  test('tapping the small Orb (back to idle) closes the panel', async () => {
    mockFetch([]);
    await send('ดูโน้ต');
    expect(screen.getByLabelText('แผง โน้ต')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('กลับหน้าเลือกผู้ช่วย'));
    expect(useAtomStore.getState().uiMode).toBe('idle');
    expect(screen.queryByLabelText('แผง โน้ต')).toBeNull();
  });
});
