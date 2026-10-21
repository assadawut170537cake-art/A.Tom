import AsyncStorage from '@react-native-async-storage/async-storage';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { Orchestrator } from '../features/ai/core/Orchestrator';
import { ProviderRegistry } from '../features/ai/core/ProviderRegistry';
import {
  addCustomProvider,
  loadCustomProviders,
  registerCustomProviders,
  removeCustomProvider,
  validateCustomProvider,
  type CustomProviderDef,
} from '../features/ai/customProviders';
import { json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';

const GROQ = { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1/', defaultModel: 'llama-x' };

beforeEach(async () => {
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

describe('validateCustomProvider', () => {
  test('สร้าง id custom-<slug> · ตัด / ท้าย · ชื่อซ้ำได้ id ใหม่', () => {
    const a = validateCustomProvider(GROQ, []);
    expect(a).toEqual({
      id: 'custom-groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-x',
    });
    expect(validateCustomProvider(GROQ, [a as CustomProviderDef])).toMatchObject({
      id: 'custom-groq-2',
    });
  });

  test('ปฏิเสธ: ไม่มีชื่อ/โมเดล · ไม่ใช่ URL · http สาธารณะ — http ในบ้านผ่าน', () => {
    expect(validateCustomProvider({ ...GROQ, name: ' ' }, [])).toHaveProperty('error');
    expect(validateCustomProvider({ ...GROQ, defaultModel: '' }, [])).toHaveProperty('error');
    expect(validateCustomProvider({ ...GROQ, baseURL: 'api.groq.com' }, [])).toHaveProperty(
      'error',
    );
    expect(
      validateCustomProvider({ ...GROQ, baseURL: 'http://api.groq.com/v1' }, []),
    ).toHaveProperty('error');
    expect(
      validateCustomProvider({ ...GROQ, baseURL: 'http://192.168.1.20:11434/v1' }, []),
    ).toMatchObject({
      baseURL: 'http://192.168.1.20:11434/v1',
    });
  });
});

test('เพิ่ม → ลงทะเบียน + จำ · เปิดแอปใหม่โหลดกลับ · ลบ → หายทั้ง registry, รายการ และ key', async () => {
  const reg = new ProviderRegistry();
  const def = validateCustomProvider(GROQ, []) as CustomProviderDef;
  await addCustomProvider(def, reg);
  expect(reg.get('custom-groq')?.config).toMatchObject({
    type: 'openai-compatible',
    models: 'dynamic',
    enabled: true,
  });

  const fresh = new ProviderRegistry();
  await expect(registerCustomProviders(fresh)).resolves.toBe(1);
  expect(fresh.get('custom-groq')?.config.name).toBe('Groq');

  await SecureKeyStore.set(secretKey('ai', 'custom-groq'), 'gsk');
  await removeCustomProvider('custom-groq', fresh);
  expect(fresh.get('custom-groq')).toBeUndefined();
  await expect(loadCustomProviders()).resolves.toEqual([]);
  await expect(SecureKeyStore.get(secretKey('ai', 'custom-groq'))).resolves.toBeNull();
});

test('ใช้คุยได้จริงผ่าน Orchestrator (Bearer key ของตัวมันเอง + /chat/completions)', async () => {
  const reg = new ProviderRegistry();
  await addCustomProvider(validateCustomProvider(GROQ, []) as CustomProviderDef, reg);
  await SecureKeyStore.set(secretKey('ai', 'custom-groq'), 'gsk');
  await ProviderSettings.setPriority(['custom-groq']);
  const { calls } = mockFetch([
    [/api\.groq\.com/, () => json({ choices: [{ message: { content: 'สวัสดี' } }] })],
  ]);
  const res = await new Orchestrator(reg).chat({ messages: [{ role: 'user', content: 'hi' }] });
  expect(res).toMatchObject({ content: 'สวัสดี', providerId: 'custom-groq' });
  expect(nth(calls, 0).url.href).toBe('https://api.groq.com/openai/v1/chat/completions');
  expect(nth(calls, 0).headers.Authorization).toBe('Bearer gsk');
  expect(nth(calls, 0).body).toMatchObject({ model: 'llama-x' });
});
