import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderError } from '../core/http/errors';
import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore } from '../core/storage/SecureKeyStore';
import type { AIProvider, AIProviderConfig } from '../features/ai/core/types';
import { ModelPicker } from '../features/settings/components/ModelPicker';
import { ProviderCard } from '../features/settings/components/ProviderCard';
import { modelListCache } from '../features/settings/modelListCache';
import { nth } from '../test-utils/nth';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const CONFIG: AIProviderConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  type: 'gemini',
  baseURL: 'https://example.invalid',
  defaultModel: 'gemini-3-flash',
  models: ['gemini-3-flash', 'gemini-3-pro'],
  enabled: true,
  purpose: 'llm',
};

function fakeProvider(listModels?: () => Promise<string[]>, config: AIProviderConfig = CONFIG): AIProvider {
  return {
    config,
    chat: jest.fn(),
    testConnection: jest.fn(async () => ({ ok: true })),
    getModels: jest.fn(async () => []),
    ...(listModels && { listModels }),
  };
}

async function renderPicker(provider: AIProvider, hasKey: boolean | null, value = 'gemini-3-flash') {
  const onChange = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ModelPicker provider={provider} value={value} hasKey={hasKey} onChange={onChange} />
    </SafeAreaProvider>
  );
  return { onChange };
}

const openPicker = () => fireEvent.press(screen.getByLabelText(/^โมเดล: /));

beforeEach(() => modelListCache.clear());

describe('ModelPicker', () => {
  test('shows the current model; opening with a key loads the live list once and caches it', async () => {
    const list = jest.fn(async () => ['gemini-2.5-pro', 'gemini-3-flash', 'gemini-3.5-pro']);
    await renderPicker(fakeProvider(list), true);
    expect(screen.getByText('gemini-3-flash')).toBeTruthy();
    expect(list).not.toHaveBeenCalled(); // ไม่ยิง API จนกว่าจะเปิด

    await openPicker();
    expect(await screen.findByText('gemini-3.5-pro')).toBeTruthy();
    expect(screen.getByText('รายชื่อจาก Google Gemini · 3 โมเดล')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    expect(modelListCache.get('gemini')).toEqual(['gemini-2.5-pro', 'gemini-3-flash', 'gemini-3.5-pro']);
  });

  test('picking an item calls onChange and closes', async () => {
    const { onChange } = await renderPicker(fakeProvider(async () => ['a-model', 'b-model']), true);
    await openPicker();
    await fireEvent.press(await screen.findByText('b-model'));
    expect(onChange).toHaveBeenCalledWith('b-model');
    await waitFor(() => expect(screen.queryByText('a-model')).toBeNull());
  });

  test('search filters case-insensitively; no match shows a Thai empty state', async () => {
    await renderPicker(fakeProvider(async () => ['gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-pro']), true);
    await openPicker();
    await screen.findByText('gemini-2.5-pro');
    expect(screen.getByRole('menuitem', { name: 'gemini-3-flash' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('ค้นหาโมเดล'), 'PRO');
    expect(screen.getByText('gemini-2.5-pro')).toBeTruthy();
    expect(screen.getByText('gemini-3-pro')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'gemini-3-flash' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('ค้นหาโมเดล'), 'zzz');
    expect(screen.getByText('ไม่พบโมเดลที่มีคำว่า "zzz"')).toBeTruthy();
  });

  test('uses the session cache instead of calling the API again; refresh bypasses it', async () => {
    modelListCache.set('gemini', ['cached-model']);
    const list = jest.fn(async () => ['fresh-model']);
    await renderPicker(fakeProvider(list), true);
    await openPicker();
    expect(screen.getByText('cached-model')).toBeTruthy();
    expect(list).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('โหลดรายชื่อใหม่'));
    expect(await screen.findByText('fresh-model')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    expect(modelListCache.get('gemini')).toEqual(['fresh-model']);
  });

  test('no saved key: Thai hint, static list, refresh disabled, no request', async () => {
    const list = jest.fn(async () => ['x']);
    await renderPicker(fakeProvider(list), false);
    await openPicker();
    expect(screen.getByText(/ยังไม่ได้บันทึก API key ของ Google Gemini/)).toBeTruthy();
    expect(screen.getByText('gemini-3-pro')).toBeTruthy(); // รายการเริ่มต้นจาก config
    expect(screen.getByText('รายการเริ่มต้นของแอป (ยังไม่ได้โหลดจาก API)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'โหลดรายชื่อใหม่' })).toBeDisabled();
    expect(list).not.toHaveBeenCalled();
  });

  test('loading state while the request is in flight', async () => {
    let resolve: (models: string[]) => void = () => undefined;
    const list = jest.fn(() => new Promise<string[]>((r) => (resolve = r)));
    await renderPicker(fakeProvider(list), true);
    await openPicker();
    expect(screen.getByText('กำลังโหลดรายชื่อโมเดล…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'กำลังโหลด…' })).toBeDisabled();
    resolve(['done-model']);
    expect(await screen.findByText('done-model')).toBeTruthy();
    expect(screen.queryByText('กำลังโหลดรายชื่อโมเดล…')).toBeNull();
  });

  test('error: Thai message, no auto-retry, then manual entry saves a typed model', async () => {
    const list = jest.fn(async (): Promise<string[]> => {
      throw new ProviderError('gemini', 'auth', 'HTTP 401: API key ไม่ถูกต้องหรือไม่มีสิทธิ์');
    });
    const { onChange } = await renderPicker(fakeProvider(list), true);
    await openPicker();
    expect(await screen.findByText(/โหลดรายชื่อโมเดลไม่ได้ — \[gemini\] HTTP 401/)).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    // ปิดแล้วเปิดใหม่ไม่ยิงซ้ำเอง
    await fireEvent.press(screen.getByLabelText('ปิด'));
    await openPicker();
    expect(list).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByText('พิมพ์ชื่อเอง'));
    const input = screen.getByLabelText('ชื่อโมเดล');
    expect(input.props.value).toBe('gemini-3-flash'); // เริ่มจากค่าปัจจุบัน
    await fireEvent.changeText(input, '  gemini-4-ultra  ');
    await fireEvent.press(screen.getByText('ใช้ชื่อนี้'));
    expect(onChange).toHaveBeenCalledWith('gemini-4-ultra');
  });

  test('manual entry starts from the search text and rejects blanks', async () => {
    const { onChange } = await renderPicker(fakeProvider(), true);
    await openPicker();
    await fireEvent.changeText(screen.getByLabelText('ค้นหาโมเดล'), 'my-custom');
    await fireEvent.press(screen.getByText('พิมพ์ชื่อเอง'));
    expect(screen.getByLabelText('ชื่อโมเดล').props.value).toBe('my-custom');
    await fireEvent.changeText(screen.getByLabelText('ชื่อโมเดล'), '   ');
    expect(screen.getByRole('button', { name: 'ใช้ชื่อนี้' })).toBeDisabled();
    await fireEvent.press(screen.getByText('ยกเลิก'));
    expect(screen.getByLabelText('ค้นหาโมเดล')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('provider without listModels: no refresh button; a saved model outside the list still shows', async () => {
    await renderPicker(fakeProvider(), true, 'typed-by-boss');
    await openPicker();
    expect(screen.queryByText('โหลดรายชื่อใหม่')).toBeNull();
    expect(screen.getAllByText('typed-by-boss').length).toBeGreaterThanOrEqual(2); // ปุ่ม + แถวในรายการ
    expect(screen.getByText('gemini-3-pro')).toBeTruthy();
  });
});

describe('ProviderCard + ModelPicker', () => {
  beforeEach(async () => {
    await SecureKeyStore.delete('ai.gemini');
    await ProviderSettings.setModelFor('gemini', 'gemini-3-flash');
  });

  test('saving a key enables loading; the picked model is persisted', async () => {
    const list = jest.fn(async () => ['gemini-3-flash', 'gemini-3.5-pro']);
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ProviderCard provider={fakeProvider(list)} />
      </SafeAreaProvider>
    );
    await openPicker();
    expect(await screen.findByText(/ยังไม่ได้บันทึก API key/)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('ปิด'));

    modelListCache.set('gemini', ['stale-from-old-key']);
    await fireEvent.changeText(screen.getByLabelText('API key'), 'new-key');
    await fireEvent.press(nth(screen.getAllByText('บันทึก'), 0));
    await screen.findByLabelText('API key บันทึกแล้ว');
    expect(modelListCache.get('gemini')).toBeUndefined(); // key ใหม่ → ทิ้ง cache เดิม

    await openPicker();
    await fireEvent.press(await screen.findByText('gemini-3.5-pro'));
    expect(list).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await ProviderSettings.getModelFor('gemini')).toBe('gemini-3.5-pro'));
    expect(screen.getByLabelText('โมเดล: gemini-3.5-pro')).toBeTruthy();
  });
});
