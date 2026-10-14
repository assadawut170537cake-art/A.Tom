import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocalMemoryAdapter, localMemory } from '../core/memory/LocalMemoryAdapter';
import { ALL_MEMORY_TARGETS, type MemoryStore } from '../core/memory/types';
import { MAX_VALUE_LENGTH, filterFacts, sourceLabel, validateDraft } from '../features/memory/factModel';
import { MemoryScreen } from '../features/memory/screens/MemoryScreen';
import { MAX_FACT_LENGTH } from '../features/router/handlers/ChatHandler';
import { useTabsStore } from '../features/jarvis/stores/useTabsStore';
import { RootNavigator } from '../navigation/RootNavigator';
import { registerAll, resetSettings, resetStore } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const EMPTY = 'ยังไม่มีความจำ — ลองเพิ่มสิ';
/**
 * Let async loads finish AND FlatList's cell batcher (updateCellsBatchingPeriod = 50 ms) fire inside act —
 * otherwise, on a busy machine, it can fire during a later plain `await` and warn "not wrapped in act".
 */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 60)));
let memory: LocalMemoryAdapter;

beforeAll(registerAll);

beforeEach(async () => {
  await AsyncStorage.clear();
  memory = new LocalMemoryAdapter();
});

afterEach(() => jest.restoreAllMocks());

async function renderScreen(store: MemoryStore = memory) {
  await render(<MemoryScreen memory={store} />);
  await screen.findByText('ความจำของ A.T.O.M.');
  await settle(); // initial load
}

/** Open the editor (FAB or a row), fill it, and save. */
async function fillAndSave(fields: { key?: string; value?: string; scope?: 'Global (ทุกผู้ช่วย)' | 'Persona'; persona?: string }) {
  if (fields.key !== undefined) await fireEvent.changeText(screen.getByLabelText('ชื่อ key'), fields.key);
  if (fields.value !== undefined) await fireEvent.changeText(screen.getByLabelText('สิ่งที่ให้จำ'), fields.value);
  if (fields.scope) await fireEvent.press(screen.getByRole('radio', { name: fields.scope }));
  if (fields.persona) await fireEvent.press(screen.getByRole('radio', { name: fields.persona }));
  await fireEvent.press(screen.getByRole('button', { name: 'บันทึก' }));
  await settle();
}

const rows = () =>
  screen.queryAllByHintText('แตะเพื่อแก้ไข กดค้างเพื่อลบ').map((r) => String(r.props.accessibilityLabel));

describe('Memory screen — list', () => {
  test('empty memory → header, filters and the empty-state message', async () => {
    await renderScreen();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    for (const name of ['ทั้งหมด', 'Global', 'Persona']) expect(screen.getByRole('tab', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เพิ่มความจำ' })).toBeTruthy();
  });

  test('facts are listed newest first with key, value, scope and source badges', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now++);
    await memory.save({ scope: 'global' }, 'drink', 'กาแฟดำ', 'user');
    await memory.save({ scope: 'persona', persona: 3 }, 'meeting', 'ประชุมทุกวันจันทร์', 'system');
    await renderScreen();

    expect(rows()).toEqual(['meeting: ประชุมทุกวันจันทร์', 'drink: กาแฟดำ']);
    const friday = screen.getByRole('button', { name: 'meeting: ประชุมทุกวันจันทร์' });
    expect(within(friday).getByText('meeting')).toBeTruthy();
    expect(within(friday).getByText('ไฟรเดย์')).toBeTruthy(); // persona badge
    expect(within(friday).getByText('ระบบ')).toBeTruthy(); // source badge
    const global = screen.getByRole('button', { name: 'drink: กาแฟดำ' });
    expect(within(global).getByText('Global')).toBeTruthy();
    expect(within(global).getByText('บอสเพิ่มเอง')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  test('filter tabs: ทั้งหมด / Global / Persona (with counts)', async () => {
    await memory.save({ scope: 'global' }, 'g1', 'global one');
    await memory.save({ scope: 'persona', persona: 1 }, 'p1', 'atom one');
    await memory.save({ scope: 'persona', persona: 4 }, 'p4', 'ultron one');
    await renderScreen();
    expect(rows()).toHaveLength(3);

    await fireEvent.press(screen.getByRole('tab', { name: 'Global' }));
    expect(rows()).toEqual(['g1: global one']);
    expect(screen.getByRole('tab', { name: 'Global' }).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('tab', { name: 'Persona' }));
    expect(rows().sort()).toEqual(['p1: atom one', 'p4: ultron one']);

    await fireEvent.press(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    expect(rows()).toHaveLength(3);
    expect(within(screen.getByRole('tab', { name: 'Persona' })).getByText('2')).toBeTruthy();
  });

  test('a filter with nothing in it says so (not the "no memory at all" message)', async () => {
    await memory.save({ scope: 'global' }, 'only_global', 'x');
    await renderScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Persona' }));
    expect(screen.getByText('ไม่มีความจำในหมวดนี้')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  test('a store that fails to load → error notice + empty list, no crash', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(memory, 'list').mockRejectedValue(new Error('locked'));
    await renderScreen();
    expect(screen.getByText('อ่านความจำไม่ได้ — ลองปิดแล้วเปิดแท็บนี้ใหม่')).toBeTruthy();
    expect(error).toHaveBeenCalledWith('[memory] โหลดความจำไม่ได้', expect.any(Error));
  });
});

describe('Memory screen — add / edit / delete', () => {
  test('add a global fact → appears in the list and is stored with source "user"', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    expect(screen.getByText('เพิ่มความจำ', { exact: true })).toBeTruthy();
    await fillAndSave({ key: 'favorite_drink', value: '  กาแฟดำ ไม่ใส่น้ำตาล  ' });

    expect(rows()).toEqual(['favorite_drink: กาแฟดำ ไม่ใส่น้ำตาล']);
    await expect(memory.load({ scope: 'global' }, 'favorite_drink')).resolves.toMatchObject({
      value: 'กาแฟดำ ไม่ใส่น้ำตาล',
      source: 'user',
    });
    expect(screen.queryByLabelText('ชื่อ key')).toBeNull(); // editor closed
  });

  test('add a persona fact → stored under the chosen persona', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    await fillAndSave({ key: 'nickname', value: 'ลูกพี่เค้ก', scope: 'Persona', persona: 'อัลตรอน' });
    await expect(memory.load({ scope: 'persona', persona: 4 }, 'nickname')).resolves.toMatchObject({ value: 'ลูกพี่เค้ก' });
    await expect(memory.load({ scope: 'global' }, 'nickname')).resolves.toBeNull();
    expect(within(screen.getByRole('button', { name: 'nickname: ลูกพี่เค้ก' })).getByText('อัลตรอน')).toBeTruthy();
  });

  test('tap → editor prefilled → change value → list and storage updated', async () => {
    await memory.save({ scope: 'persona', persona: 2 }, 'tone', 'สุภาพ');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'tone: สุภาพ' }));

    expect(screen.getByText('แก้ไขความจำ')).toBeTruthy();
    expect(screen.getByLabelText('ชื่อ key').props.value).toBe('tone');
    expect(screen.getByLabelText('สิ่งที่ให้จำ').props.value).toBe('สุภาพ');
    expect(screen.getByRole('radio', { name: 'จาร์วิส' }).props.accessibilityState).toMatchObject({ selected: true });

    await fillAndSave({ value: 'สุภาพ แต่ขำได้' });
    expect(rows()).toEqual(['tone: สุภาพ แต่ขำได้']);
    await expect(memory.load({ scope: 'persona', persona: 2 }, 'tone')).resolves.toMatchObject({ value: 'สุภาพ แต่ขำได้' });
  });

  test('editing the key or scope moves the fact (old one removed)', async () => {
    await memory.save({ scope: 'global' }, 'old_key', 'ค่า');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'old_key: ค่า' }));
    await fillAndSave({ key: 'new_key', scope: 'Persona', persona: 'ไฟรเดย์' });

    expect(rows()).toEqual(['new_key: ค่า']);
    await expect(memory.load({ scope: 'global' }, 'old_key')).resolves.toBeNull();
    await expect(memory.load({ scope: 'persona', persona: 3 }, 'new_key')).resolves.toMatchObject({ value: 'ค่า' });
  });

  test('a key that already exists in that scope is refused (no silent overwrite)', async () => {
    await memory.save({ scope: 'global' }, 'drink', 'กาแฟ');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    await fillAndSave({ key: 'drink', value: 'ชาเขียว' });
    expect(screen.getByText('มีความจำ key นี้ในขอบเขตนี้แล้ว — แตะที่รายการนั้นเพื่อแก้ไขแทน')).toBeTruthy();
    await expect(memory.load({ scope: 'global' }, 'drink')).resolves.toMatchObject({ value: 'กาแฟ' });
  });

  test('long-press → "ลบความจำนี้?" → ลบ removes it; ยกเลิก keeps it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await memory.save({ scope: 'global' }, 'a', 'one');
    await memory.save({ scope: 'global' }, 'b', 'two');
    await renderScreen();

    await fireEvent(screen.getByRole('button', { name: 'a: one' }), 'longPress');
    expect(alert).toHaveBeenCalledWith('ลบความจำนี้?', 'a: one', expect.any(Array));
    const buttons = alert.mock.calls[0]?.[2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['ยกเลิก', 'ลบ']);

    buttons[0]?.onPress?.(); // cancel: nothing happens
    await settle();
    expect(rows()).toHaveLength(2);

    await act(async () => {
      buttons[1]?.onPress?.();
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(rows()).toEqual(['b: two']));
    await settle();
    await expect(memory.load({ scope: 'global' }, 'a')).resolves.toBeNull();
  });

  test('the editor also offers ลบ for an existing fact (same confirmation)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await memory.save({ scope: 'global' }, 'x', 'y');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'x: y' }));
    await fireEvent.press(screen.getByRole('button', { name: 'ลบความจำ' }));
    expect(alert).toHaveBeenCalledWith('ลบความจำนี้?', 'x: y', expect.any(Array));

    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    expect(screen.queryByRole('button', { name: 'ลบความจำ' })).toBeNull(); // not for a new fact
  });

  test('ยกเลิก closes the editor without saving', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    await fireEvent.changeText(screen.getByLabelText('ชื่อ key'), 'draft');
    await fireEvent.changeText(screen.getByLabelText('สิ่งที่ให้จำ'), 'ไม่บันทึก');
    await fireEvent.press(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByLabelText('ชื่อ key')).toBeNull();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    await expect(memory.load({ scope: 'global' }, 'draft')).resolves.toBeNull();
  });

  test('a storage failure while saving shows a Thai error and keeps the editor open', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(memory, 'save').mockRejectedValueOnce(new Error('disk'));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    await fillAndSave({ key: 'k', value: 'v' });
    expect(screen.getByText('บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง')).toBeTruthy();
    expect(screen.getByLabelText('ชื่อ key')).toBeTruthy();
  });
});

describe('Memory screen — validation', () => {
  test.each(['มีภาษาไทย', 'has space', 'dot.key', 'x'.repeat(65)])('key %p → format error, nothing saved', async (key) => {
    const save = jest.spyOn(memory, 'save');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    await fireEvent.changeText(screen.getByLabelText('ชื่อ key'), key);
    // format errors show while typing, before pressing save
    expect(screen.getByText('key ใช้ได้เฉพาะ A-Z a-z 0-9 _ - (ไม่มีเว้นวรรค ไม่เกิน 64 ตัว)')).toBeTruthy();
    await fillAndSave({ value: 'ค่า' });
    expect(save).not.toHaveBeenCalled();
  });

  test('empty key / value → errors after pressing บันทึก', async () => {
    const save = jest.spyOn(memory, 'save');
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    expect(screen.queryByText('ใส่ชื่อ key ก่อน')).toBeNull(); // no nagging before the first try
    await fillAndSave({});
    expect(screen.getByText('ใส่ชื่อ key ก่อน')).toBeTruthy();
    expect(screen.getByText('ใส่สิ่งที่ต้องการให้จำ')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  test(`value is capped at ${MAX_VALUE_LENGTH} characters, same as ChatHandler's prompt limit`, async () => {
    expect(MAX_VALUE_LENGTH).toBe(MAX_FACT_LENGTH);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'เพิ่มความจำ' }));
    expect(screen.getByLabelText('สิ่งที่ให้จำ').props.maxLength).toBe(MAX_VALUE_LENGTH);
    await fireEvent.changeText(screen.getByLabelText('สิ่งที่ให้จำ'), 'กขค');
    expect(screen.getByLabelText('จำนวนตัวอักษร')).toHaveProperty('props.children', [3, '/', MAX_VALUE_LENGTH]);
    expect(validateDraft({ key: 'k', value: 'x'.repeat(MAX_VALUE_LENGTH + 1) }).value).toBe(
      `ยาวได้ไม่เกิน ${MAX_VALUE_LENGTH} ตัวอักษร`
    );
    expect(validateDraft({ key: 'ok_key-1', value: 'x'.repeat(MAX_VALUE_LENGTH) })).toEqual({});
  });

  test('model helpers: source labels and filters', () => {
    expect(['user', 'assistant', 'system', 'module:pc-bridge'].map((s) => sourceLabel(s as never))).toEqual([
      'บอสเพิ่มเอง', 'ผู้ช่วยจำ', 'ระบบ', 'module pc-bridge',
    ]);
    const f = (scope: 'global' | 'persona') =>
      ({ target: scope === 'global' ? { scope } : { scope, persona: 1 }, fact: { key: scope } }) as never;
    expect(filterFacts([f('global'), f('persona')], 'persona')).toHaveLength(1);
  });
});

describe('Memory tab in the app', () => {
  beforeEach(async () => {
    await resetSettings();
    resetStore();
    for (const target of ALL_MEMORY_TARGETS) await localMemory.clear(target);
  });

  test('bottom tab "Memory" shows the Memory screen (no more "เร็วๆ นี้") backed by the app memory', async () => {
    await localMemory.save({ scope: 'global' }, 'from_app', 'shared with chat');
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await fireEvent.press(await screen.findByRole('tab', { name: 'Memory' }));
    expect(await screen.findByText('ความจำของ A.T.O.M.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'from_app: shared with chat' })).toBeTruthy();
    await settle();
    expect(screen.queryByText('เร็วๆ นี้')).toBeNull();
    await act(() => useTabsStore.getState().setActiveTab('atom'));
  });
});
