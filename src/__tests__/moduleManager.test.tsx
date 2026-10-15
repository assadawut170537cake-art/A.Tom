import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocalMemoryAdapter } from '../core/memory/LocalMemoryAdapter';
import {
  MODULE_FLAGS_KEY,
  ModuleManager,
  asyncStorageModuleFlags,
  moduleManager,
  type ModuleFlagStore,
} from '../core/modules/ModuleManager';
import { ModuleRegistry, statusOf } from '../core/modules/ModuleRegistry';
import type { AtomModule, ModuleLogger } from '../core/modules/types';
import { DEV_TEST_MODULE_IDS, addTestModules, installModuleDevTools } from '../dev/moduleDevTools';
import { EMPTY_MODULES_TEXT, ModulesScreen } from '../features/settings/screens/ModulesScreen';
import { loadModule } from '../modules/loader';
import { RootNavigator } from '../navigation/RootNavigator';
import { registerAll } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Let AsyncStorage (mock = promise based) and the manager's awaits finish inside act. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));

beforeAll(registerAll);

let logger: ModuleLogger & { error: jest.Mock };

beforeEach(async () => {
  await AsyncStorage.clear();
  logger = { info: jest.fn(), error: jest.fn() };
});

afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

let journal: string[];
beforeEach(() => {
  journal = [];
});

type FakeModule = AtomModule & { init: jest.Mock; dispose: jest.Mock };

function fakeModule(
  id: string,
  opts: { deps?: string[]; enabled?: boolean; initError?: Error; description?: string } = {}
): FakeModule {
  return {
    id,
    name: `Module ${id}`,
    description: opts.description,
    enabled: opts.enabled ?? true,
    dependencies: opts.deps,
    init: jest.fn(async () => {
      journal.push(`init:${id}`);
      if (opts.initError) throw opts.initError;
    }),
    dispose: jest.fn(async () => {
      journal.push(`dispose:${id}`);
    }),
  };
}

const newRegistry = () =>
  new ModuleRegistry({ memory: new LocalMemoryAdapter(), logger: { info: jest.fn(), error: jest.fn() } });

/**
 * One "app launch": a fresh registry + manager over the SAME AsyncStorage, modules registered before
 * start() like the loader would. Calling it twice = restarting the app.
 */
async function launch(modules: AtomModule[], store: ModuleFlagStore = asyncStorageModuleFlags) {
  const registry = newRegistry();
  const manager = new ModuleManager(registry, store, logger);
  modules.forEach((m) => registry.register(m));
  const report = await manager.start();
  return { registry, manager, report };
}

const storedFlags = async () => JSON.parse((await AsyncStorage.getItem(MODULE_FLAGS_KEY)) ?? 'null') as unknown;

// ---------------------------------------------------------------------------------------------
// B — ModuleRegistry API additions
// ---------------------------------------------------------------------------------------------

describe('ModuleRegistry.getStatus / statusOf', () => {
  test('maps enabled + state to the UI status; unknown id → undefined', async () => {
    const registry = newRegistry();
    registry.register(fakeModule('ok'));
    registry.register(fakeModule('broken', { initError: new Error('no device') }));
    registry.register(fakeModule('off', { enabled: false }));
    expect(registry.getStatus('ok')).toBe('not-initialized');
    await registry.initAll();
    expect(registry.getStatus('ok')).toBe('enabled');
    expect(registry.getStatus('broken')).toBe('error');
    expect(registry.getStatus('off')).toBe('disabled');
    expect(registry.getStatus('ghost')).toBeUndefined();
    await registry.disable('broken');
    expect(registry.getStatus('broken')).toBe('disabled'); // disabled wins over a stale failure
    expect(statusOf({ enabled: true, state: 'initializing' })).toBe('not-initialized');
  });

  test('list() carries the optional description', () => {
    const registry = newRegistry();
    registry.register(fakeModule('a', { description: 'สั่งงานคอม' }));
    registry.register(fakeModule('b'));
    expect(registry.list().map((m) => m.description)).toEqual(['สั่งงานคอม', undefined]);
    expect(registry.list()[1]).not.toHaveProperty('description');
  });
});

// ---------------------------------------------------------------------------------------------
// C1 / D2 — persistence
// ---------------------------------------------------------------------------------------------

describe('ModuleManager — enable/disable persist across restarts', () => {
  test('disable → restart → still disabled (and never initialised)', async () => {
    const first = await launch([fakeModule('pc')]);
    expect(first.registry.getStatus('pc')).toBe('enabled');
    await expect(first.manager.disable('pc')).resolves.toEqual({ changed: ['pc'], saved: true });
    expect(await storedFlags()).toEqual({ pc: false });

    const pc = fakeModule('pc'); // enabled: true by default — the saved choice must win
    const second = await launch([pc]);
    expect(second.registry.isEnabled('pc')).toBe(false);
    expect(second.registry.getStatus('pc')).toBe('disabled');
    expect(pc.init).not.toHaveBeenCalled();
    expect(second.report).toEqual({ ready: [], failed: [] });
  });

  test('enable → restart → enabled (module that is off by default)', async () => {
    const first = await launch([fakeModule('extra', { enabled: false })]);
    await expect(first.manager.enable('extra')).resolves.toEqual({ changed: ['extra'], saved: true });
    expect(first.registry.getStatus('extra')).toBe('enabled');

    const second = await launch([fakeModule('extra', { enabled: false })]);
    expect(second.registry.getStatus('extra')).toBe('enabled');
    expect(second.report.ready).toEqual(['extra']);
  });

  test('modules never toggled keep their own default; flags of other modules are kept', async () => {
    await AsyncStorage.setItem(MODULE_FLAGS_KEY, JSON.stringify({ gone: true }));
    const { manager, registry } = await launch([fakeModule('a'), fakeModule('b', { enabled: false })]);
    expect([registry.isEnabled('a'), registry.isEnabled('b')]).toEqual([true, false]);
    await manager.disable('a');
    expect(await storedFlags()).toEqual({ gone: true, a: false });
  });

  test('a module registered after start (lazy loader) gets its saved flag; enabled ones init right away', async () => {
    await AsyncStorage.setItem(MODULE_FLAGS_KEY, JSON.stringify({ off: false, on: true }));
    const { manager, registry } = await launch([]);
    const off = fakeModule('off');
    const on = fakeModule('on', { enabled: false });
    await manager.register(off);
    await loadModule('on', manager, { on: async () => on });
    expect(registry.getStatus('off')).toBe('disabled');
    expect(off.init).not.toHaveBeenCalled();
    expect(registry.getStatus('on')).toBe('enabled');
    expect(on.init).toHaveBeenCalledTimes(1);
  });

  test('registered after start but failing init → logged, status error', async () => {
    const { manager, registry } = await launch([]);
    await manager.register(fakeModule('bad', { initError: new Error('no device') }));
    expect(registry.getStatus('bad')).toBe('error');
    expect(logger.error).toHaveBeenCalledWith('[modules] init "bad" ไม่สำเร็จ', expect.any(Error));
  });

  test('corrupt storage: bad fields dropped, bad JSON → defaults (logged)', async () => {
    await AsyncStorage.setItem(MODULE_FLAGS_KEY, JSON.stringify({ a: false, b: 'yes', c: 1 }));
    await expect(asyncStorageModuleFlags.load()).resolves.toEqual({ a: false });

    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await AsyncStorage.setItem(MODULE_FLAGS_KEY, '{not json');
    const { registry } = await launch([fakeModule('a')]);
    expect(registry.isEnabled('a')).toBe(true);
    expect(error).toHaveBeenCalledWith(`[storage] ${MODULE_FLAGS_KEY}: ข้อมูลเสีย — ตัดทิ้งและใช้ค่าเริ่มต้น`);
  });

  test('unreadable storage → each module keeps its default, boot still inits', async () => {
    const store: ModuleFlagStore = { load: () => Promise.reject(new Error('locked')), save: jest.fn() };
    const { report } = await launch([fakeModule('a')], store);
    expect(report.ready).toEqual(['a']);
    expect(logger.error).toHaveBeenCalledWith(
      '[modules] อ่านค่าเปิด/ปิด module ที่บันทึกไว้ไม่ได้ — ใช้ค่าเริ่มต้นของแต่ละ module',
      expect.any(Error)
    );
  });

  test('a failed save → saved:false, runtime state still changes, the next save still goes through', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('QuotaExceededError')).mockResolvedValue(undefined);
    const { manager, registry } = await launch([fakeModule('a'), fakeModule('b')], { load: async () => ({}), save });
    await expect(manager.disable('a')).resolves.toEqual({ changed: ['a'], saved: false });
    expect(registry.isEnabled('a')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      '[modules] บันทึกค่าเปิด/ปิด module ไม่สำเร็จ — เปิดแอปใหม่จะกลับเป็นค่าเดิม',
      expect.any(Error)
    );
    await expect(manager.disable('b')).resolves.toEqual({ changed: ['b'], saved: true });
    expect(save).toHaveBeenLastCalledWith({ a: false, b: false });
  });

  test('unknown ids are a no-op', async () => {
    const { manager } = await launch([]);
    await expect(manager.enable('ghost')).resolves.toEqual({ changed: [], saved: true });
    await expect(manager.disable('ghost')).resolves.toEqual({ changed: [], saved: true });
    expect(await storedFlags()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// C2 / D3 — dependencies
// ---------------------------------------------------------------------------------------------

describe('ModuleManager — dependencies', () => {
  const chain = () => [
    fakeModule('transport'),
    fakeModule('bridge', { deps: ['transport'] }),
    fakeModule('macro', { deps: ['bridge'] }),
    fakeModule('solo'),
  ];

  test('dependentsToDisable is transitive and only lists enabled modules', async () => {
    const { manager } = await launch(chain());
    expect(manager.dependentsToDisable('transport')).toEqual(['bridge', 'macro']);
    expect(manager.dependentsToDisable('solo')).toEqual([]);
    await manager.disable('macro');
    expect(manager.dependentsToDisable('transport')).toEqual(['bridge']);
  });

  test('disable cascades to dependents (disposed top-down) and persists all of them', async () => {
    const { manager, registry } = await launch(chain());
    journal = [];
    await expect(manager.disable('transport')).resolves.toEqual({
      changed: ['transport', 'bridge', 'macro'],
      saved: true,
    });
    expect(journal).toEqual(['dispose:macro', 'dispose:bridge', 'dispose:transport']);
    expect(registry.getStatus('solo')).toBe('enabled');
    expect(await storedFlags()).toEqual({ transport: false, bridge: false, macro: false });
  });

  test('enable auto-enables disabled dependencies (deepest first), inits them, persists them', async () => {
    const { manager, registry } = await launch(chain());
    await manager.disable('transport');
    expect(manager.dependenciesToEnable('macro')).toEqual(['transport', 'bridge']);
    journal = [];
    await expect(manager.enable('macro')).resolves.toEqual({ changed: ['transport', 'bridge', 'macro'], saved: true });
    expect(journal).toEqual(['init:transport', 'init:bridge', 'init:macro']);
    expect(registry.list().map((m) => m.state)).toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(await storedFlags()).toEqual({ transport: true, bridge: true, macro: true });
  });

  test('a missing or failing dependency → still enabled, error reported (not thrown)', async () => {
    const { manager, registry } = await launch([
      fakeModule('orphan', { deps: ['ghost'], enabled: false }),
      fakeModule('cyc-a', { deps: ['cyc-b'], enabled: false }),
      fakeModule('cyc-b', { deps: ['cyc-a'], enabled: false }),
    ]);
    expect(manager.dependenciesToEnable('orphan')).toEqual([]);
    const result = await manager.enable('orphan');
    expect(result).toEqual({ changed: ['orphan'], saved: true, error: '"orphan" ต้องใช้ "ghost": ไม่พบ module "ghost"' });
    expect(registry.getStatus('orphan')).toBe('error');
    expect(manager.dependenciesToEnable('cyc-a')).toEqual(['cyc-b']); // cycle does not loop forever
  });
});

// ---------------------------------------------------------------------------------------------
// A2 — reinitialize
// ---------------------------------------------------------------------------------------------

describe('ModuleManager.reinitialize', () => {
  test('a failed module is retried; success clears the error', async () => {
    const flaky = fakeModule('flaky');
    flaky.init.mockRejectedValueOnce(new Error('first try'));
    const { manager, registry } = await launch([flaky]);
    expect(registry.getStatus('flaky')).toBe('error');
    await manager.reinitialize('flaky');
    expect(registry.getStatus('flaky')).toBe('enabled');
    expect(manager.getSnapshot()[0]?.error).toBeUndefined();
  });

  test('a ready module restarts; its ready dependents restart after it; the saved flag is untouched', async () => {
    const { manager, registry } = await launch([fakeModule('base'), fakeModule('top', { deps: ['base'] })]);
    journal = [];
    await manager.reinitialize('base');
    expect(journal).toEqual(['dispose:top', 'dispose:base', 'init:base', 'init:top']);
    expect(registry.list().map((m) => m.state)).toEqual(['ready', 'ready']);
    expect(await storedFlags()).toBeNull();
  });

  test('a dependent that fails to restart is logged, the module itself is fine', async () => {
    const top = fakeModule('top', { deps: ['base'] });
    const { manager, registry } = await launch([fakeModule('base'), top]);
    top.init.mockRejectedValueOnce(new Error('lost'));
    await manager.reinitialize('base');
    expect(registry.getStatus('base')).toBe('enabled');
    expect(registry.getStatus('top')).toBe('error');
    expect(logger.error).toHaveBeenCalledWith('[modules] เริ่ม "top" ใหม่ไม่สำเร็จ', expect.any(Error));
  });

  test('still failing → rejects with the reason; disabled → rejects', async () => {
    const { manager } = await launch([
      fakeModule('dead', { initError: new Error('no device') }),
      fakeModule('off', { enabled: false }),
    ]);
    await expect(manager.reinitialize('dead')).rejects.toThrow('no device');
    await expect(manager.reinitialize('off')).rejects.toThrow('module "off" ถูกปิดอยู่');
  });
});

describe('ModuleManager — UI store', () => {
  test('getSnapshot: status + direct usedBy; same object until something changes', async () => {
    const { manager } = await launch([fakeModule('base'), fakeModule('top', { deps: ['base'] })]);
    const first = manager.getSnapshot();
    expect(first.map((m) => [m.id, m.status, m.usedBy])).toEqual([
      ['base', 'enabled', ['top']],
      ['top', 'enabled', []],
    ]);
    expect(manager.getSnapshot()).toBe(first);
    await manager.disable('top');
    expect(manager.getSnapshot()).not.toBe(first);
    expect(manager.getSnapshot()[1]?.status).toBe('disabled');
  });

  test('subscribers hear about changes until they unsubscribe', async () => {
    const { manager } = await launch([fakeModule('a')]);
    const listener = jest.fn();
    const unsubscribe = manager.subscribe(listener);
    await manager.disable('a');
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    await manager.enable('a');
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// A1 / D1 — Modules screen
// ---------------------------------------------------------------------------------------------

const switchOf = (name: string) => screen.getByLabelText(`เปิดใช้ ${name}`);
const isOn = (name: string) => Boolean(switchOf(name).props.value);

async function renderScreen(manager: ModuleManager) {
  const view = await render(<ModulesScreen manager={manager} />);
  await settle();
  return view;
}

async function toggle(name: string, on: boolean) {
  await fireEvent(switchOf(name), 'valueChange', on);
  await settle();
}

describe('Modules screen', () => {
  test('no modules → empty state', async () => {
    const { manager } = await launch([]);
    await renderScreen(manager);
    expect(screen.getByText(EMPTY_MODULES_TEXT)).toBeTruthy();
    expect(EMPTY_MODULES_TEXT).toBe('ยังไม่มี Module — รอ Phase 4.5.5');
  });

  test('lists each module with description, status badge, dependency badge and a switch', async () => {
    const { manager } = await launch([
      fakeModule('transport', { description: 'ช่องทางคุยกับคอม' }),
      fakeModule('bridge', { deps: ['transport'] }),
      fakeModule('broken', { initError: new Error('no device AIzaSyLEAKED123') }),
      fakeModule('off', { enabled: false }),
    ]);
    await renderScreen(manager);
    expect(screen.queryByText(EMPTY_MODULES_TEXT)).toBeNull();

    const transport = screen.getByRole('button', { name: 'Module transport' });
    expect(within(transport).getByText('ช่องทางคุยกับคอม')).toBeTruthy();
    expect(within(transport).getByText('ทำงานอยู่')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Module bridge' })).getByText('ต้องใช้: Module transport')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Module broken' })).getByText('เริ่มไม่สำเร็จ')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Module off' })).getByText('ปิดอยู่')).toBeTruthy();
    // init error is shown, with secrets masked
    expect(screen.getByText('no device [REDACTED]')).toBeTruthy();
    expect([isOn('Module transport'), isOn('Module broken'), isOn('Module off')]).toEqual([true, true, false]);
  });

  test('toggle off / on works and is saved', async () => {
    const { manager, registry } = await launch([fakeModule('a')]);
    await renderScreen(manager);

    await toggle('Module a', false);
    expect(isOn('Module a')).toBe(false);
    expect(registry.getStatus('a')).toBe('disabled');
    expect(await storedFlags()).toEqual({ a: false });

    await toggle('Module a', true);
    expect(isOn('Module a')).toBe(true);
    expect(within(screen.getByRole('button', { name: 'Module a' })).getByText('ทำงานอยู่')).toBeTruthy();
    expect(await storedFlags()).toEqual({ a: true });
  });

  test('D2 through the UI: disable → restart the app → the switch is still off', async () => {
    const first = await launch([fakeModule('pc')]);
    const view = await renderScreen(first.manager);
    await toggle('Module pc', false);
    await view.unmount();

    const second = await launch([fakeModule('pc')]);
    await renderScreen(second.manager);
    expect(isOn('Module pc')).toBe(false);
    expect(within(screen.getByRole('button', { name: 'Module pc' })).getByText('ปิดอยู่')).toBeTruthy();
  });

  test('tap → details (id, status, needs, used by) with enable/disable + เริ่มใหม่; tap again collapses', async () => {
    const { manager } = await launch([fakeModule('base'), fakeModule('top', { deps: ['base', 'ghost'] })]);
    await renderScreen(manager);

    await fireEvent.press(screen.getByRole('button', { name: 'Module top' }));
    expect(screen.getByText('top')).toBeTruthy(); // id
    expect(screen.getByText('Module base · ทำงานอยู่\nghost · ไม่ได้ติดตั้ง')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Module top' }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByRole('button', { name: 'ปิด module' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เริ่มใหม่' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Module base' })); // only one open at a time
    expect(screen.queryByText('top')).toBeNull();
    expect(screen.getAllByText('Module top')).toHaveLength(2); // its own row + "used by" in base's details

    await fireEvent.press(screen.getByRole('button', { name: 'Module base' }));
    expect(screen.queryByRole('button', { name: 'เริ่มใหม่' })).toBeNull();
  });

  test('detail buttons: ปิด module / เปิด module; no เริ่มใหม่ while off', async () => {
    const { manager, registry } = await launch([fakeModule('a')]);
    await renderScreen(manager);
    await fireEvent.press(screen.getByRole('button', { name: 'Module a' }));
    await fireEvent.press(screen.getByRole('button', { name: 'ปิด module' }));
    await settle();
    expect(registry.isEnabled('a')).toBe(false);
    expect(screen.queryByRole('button', { name: 'เริ่มใหม่' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'เปิด module' }));
    await settle();
    expect(registry.getStatus('a')).toBe('enabled');
  });

  test('เริ่มใหม่ on a failed module → works → notice; still failing → error notice (redacted)', async () => {
    const flaky = fakeModule('flaky');
    flaky.init.mockRejectedValueOnce(new Error('first try'));
    const dead = fakeModule('dead', { initError: new Error('key sk-abc123 rejected') });
    const { manager } = await launch([flaky, dead]);
    await renderScreen(manager);

    await fireEvent.press(screen.getByRole('button', { name: 'Module flaky' }));
    await fireEvent.press(screen.getByRole('button', { name: 'เริ่มใหม่' }));
    await settle();
    expect(screen.getByText('เริ่ม Module flaky ใหม่แล้ว')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Module flaky' })).getByText('ทำงานอยู่')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Module dead' }));
    await fireEvent.press(screen.getByRole('button', { name: 'เริ่มใหม่' }));
    await settle();
    expect(screen.getByRole('alert', { name: 'Module dead ยังเริ่มไม่สำเร็จ: key [REDACTED] rejected' })).toBeTruthy();
  });

  test('a failed save shows a warning; an unexpected failure shows a generic error', async () => {
    const save = jest.fn().mockRejectedValue(new Error('full'));
    const { manager } = await launch([fakeModule('a'), fakeModule('b')], { load: async () => ({}), save });
    await renderScreen(manager);
    await toggle('Module a', false);
    expect(
      screen.getByText('บันทึกค่าลงเครื่องไม่สำเร็จ — ตอนนี้ใช้ได้ตามที่ตั้ง แต่เปิดแอปใหม่จะกลับเป็นค่าเดิม')
    ).toBeTruthy();

    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(manager, 'disable').mockRejectedValueOnce(new Error('boom'));
    await toggle('Module b', false);
    expect(screen.getByText('ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง')).toBeTruthy();
    expect(error).toHaveBeenCalledWith('[settings] จัดการ module ไม่สำเร็จ', expect.any(Error));
  });

  test('switches are disabled while an action runs', async () => {
    let finish: () => void = () => {};
    const slow = fakeModule('slow', { enabled: false });
    slow.init.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = () => r();
        })
    );
    const { manager } = await launch([slow, fakeModule('other')]);
    await renderScreen(manager);
    await toggle('Module slow', true);
    expect(switchOf('Module other').props.disabled).toBe(true);
    await act(async () => finish());
    await settle();
    expect(switchOf('Module other').props.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// D3 — dependency warnings in the UI
// ---------------------------------------------------------------------------------------------

describe('Modules screen — dependencies', () => {
  const modules = () => [fakeModule('transport'), fakeModule('bridge', { deps: ['transport'] }), fakeModule('solo')];

  test('disabling a module others need → "ปิด …?" warning; ยกเลิก keeps everything on', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { manager, registry } = await launch(modules());
    await renderScreen(manager);

    await toggle('Module transport', false);
    expect(alert).toHaveBeenCalledWith(
      'ปิด Module transport?',
      'module ต่อไปนี้ต้องใช้ Module transport และจะถูกปิดไปด้วย:\n• Module bridge',
      expect.any(Array)
    );
    const buttons = alert.mock.calls[0]?.[2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['ยกเลิก', 'ปิดทั้งหมด']);
    expect(buttons[1]?.style).toBe('destructive');

    buttons[0]?.onPress?.();
    await settle();
    expect([registry.isEnabled('transport'), registry.isEnabled('bridge')]).toEqual([true, true]);
    expect(isOn('Module transport')).toBe(true);
  });

  test('ปิดทั้งหมด → both off + notice', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { manager, registry } = await launch(modules());
    await renderScreen(manager);
    await toggle('Module transport', false);
    const buttons = alert.mock.calls[0]?.[2] as AlertButton[];
    await act(async () => {
      buttons[1]?.onPress?.();
    });
    await settle();
    expect([isOn('Module transport'), isOn('Module bridge'), isOn('Module solo')]).toEqual([false, false, true]);
    expect(registry.isEnabled('bridge')).toBe(false);
    expect(screen.getByText('ปิด Module bridge ไปด้วย เพราะต้องใช้ Module transport')).toBeTruthy();
  });

  test('no warning for a module nothing (enabled) depends on', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { manager } = await launch(modules());
    await renderScreen(manager);
    await toggle('Module bridge', false);
    await toggle('Module transport', false); // bridge already off → no one to warn about
    await toggle('Module solo', false);
    expect(alert).not.toHaveBeenCalled();
    expect([isOn('Module transport'), isOn('Module solo')]).toEqual([false, false]);
  });

  test('enabling a module whose dependency is off → dependency turned on too + notice', async () => {
    const { manager, registry } = await launch(modules());
    await manager.disable('transport'); // cascades to bridge
    await renderScreen(manager);
    expect([isOn('Module transport'), isOn('Module bridge')]).toEqual([false, false]);

    await toggle('Module bridge', true);
    await waitFor(() => expect([isOn('Module transport'), isOn('Module bridge')]).toEqual([true, true]));
    expect(screen.getByText('เปิด Module transport ให้ด้วย เพราะ Module bridge ต้องใช้')).toBeTruthy();
    expect(registry.list().map((m) => m.state)).toEqual(['ready', 'ready', 'ready']);
  });
});

// ---------------------------------------------------------------------------------------------
// A3 — Settings hub entry
// ---------------------------------------------------------------------------------------------

describe('Settings hub → Modules', () => {
  test('"Modules" sits between AI Providers and Voice, and opens the (empty) Modules screen', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await fireEvent.press(await screen.findByLabelText('ตั้งค่า'));
    await screen.findByText('Persona Voice Map');
    const entries = screen
      .getAllByRole('button')
      .map((b) => String(b.props.accessibilityLabel))
      .filter((l) => ['AI Providers', 'Modules', 'Voice (TTS + STT)', 'Persona Voice Map'].includes(l));
    expect(entries).toEqual(['AI Providers', 'Modules', 'Voice (TTS + STT)', 'Persona Voice Map']);

    await fireEvent.press(screen.getByRole('button', { name: 'Modules' }));
    expect(await screen.findByText(EMPTY_MODULES_TEXT)).toBeTruthy();
    expect(moduleManager.getSnapshot()).toEqual([]); // the app has no real module yet (Phase 4.5.5)
  });
});

// ---------------------------------------------------------------------------------------------
// Dev tools (manual testing on the emulator)
// ---------------------------------------------------------------------------------------------

describe('module dev tools', () => {
  test('menu item adds the 3 test modules once; flaky fails first, then เริ่มใหม่ works', async () => {
    const { manager, registry } = await launch([]);
    const items = new Map<string, () => void>();
    installModuleDevTools(manager, { addMenuItem: (title: string, handler: () => void) => items.set(title, handler) });
    expect([...items.keys()]).toEqual(['A.T.O.M.: เพิ่ม module ทดสอบ']);

    items.get('A.T.O.M.: เพิ่ม module ทดสอบ')?.();
    await settle();
    await addTestModules(manager); // pressing again does not duplicate
    expect(registry.list().map((m) => m.id)).toEqual([...DEV_TEST_MODULE_IDS]);
    expect(registry.list().map((m) => registry.getStatus(m.id))).toEqual(['enabled', 'enabled', 'error']);

    await manager.reinitialize('dev-flaky');
    expect(registry.getStatus('dev-flaky')).toBe('enabled');
    await manager.disable('dev-transport');
    expect(registry.isEnabled('dev-pc-bridge')).toBe(false);
  });

  test('atomDev keeps the memory tools and gains addTestModules; a failing add is logged', async () => {
    const { manager } = await launch([]);
    const seed = jest.fn();
    Object.assign(globalThis, { atomDev: { seed } });
    const items = new Map<string, () => void>();
    installModuleDevTools(manager, { addMenuItem: (title: string, handler: () => void) => items.set(title, handler) });
    const atomDev: unknown = Reflect.get(globalThis, 'atomDev');
    expect(atomDev).toEqual({ seed, addTestModules: expect.any(Function) });

    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(manager, 'register').mockRejectedValueOnce(new Error('dup'));
    items.get('A.T.O.M.: เพิ่ม module ทดสอบ')?.();
    await settle();
    expect(error).toHaveBeenCalledWith('[dev] เพิ่ม module ทดสอบไม่สำเร็จ', expect.any(Error));
  });
});
