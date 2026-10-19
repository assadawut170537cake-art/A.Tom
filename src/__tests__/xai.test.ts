import { SecureKeyStore, secretKey } from '../core/storage/SecureKeyStore';
import { PROVIDERS } from '../features/ai';
import { voiceRegistry } from '../features/voice/core/VoiceRegistry';
import { parseXaiVoices } from '../features/voice/tts/XaiTTS';
import { xaiKey } from '../features/voice/xaiKey';
import { json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';
import { registerAll } from '../test-utils/setup';

beforeAll(registerAll);
beforeEach(async () => {
  for (const k of [secretKey('ai', 'xai'), secretKey('tts', 'xai'), secretKey('stt', 'xai')]) {
    await SecureKeyStore.delete(k);
  }
});
afterEach(() => jest.restoreAllMocks());

test('Grok: OpenAI-compatible · ปิดไว้ก่อน · รุ่น non-reasoning (ตอบเร็ว)', () => {
  expect(PROVIDERS.find((p) => p.id === 'xai')).toMatchObject({
    type: 'openai-compatible',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.20-0309-non-reasoning',
    enabled: false,
  });
});

test('key เดียวใช้ได้ทั้งสามทาง: การ์ดเสียงว่าง → ใช้ key ของ Grok · ใส่แยก = ใช้ตัวที่ใส่', async () => {
  await expect(xaiKey('tts')).rejects.toMatchObject({ kind: 'missing_key' });
  await SecureKeyStore.set(secretKey('ai', 'xai'), 'grok-key');
  await expect(xaiKey('tts')).resolves.toBe('grok-key');
  await expect(xaiKey('stt')).resolves.toBe('grok-key');
  await SecureKeyStore.set(secretKey('stt', 'xai'), 'stt-own');
  await expect(xaiKey('stt')).resolves.toBe('stt-own');

  const { calls } = mockFetch([
    [/api\.x\.ai/, () => json({ voices: [{ voice_id: 'ara', name: 'Ara' }] })],
  ]);
  await expect(voiceRegistry.getTTS('xai')?.getVoices()).resolves.toEqual([
    { id: 'ara', name: 'Ara' },
  ]);
  expect(nth(calls, 0).headers.Authorization).toBe('Bearer grok-key');
});

test('parseXaiVoices: ข้ามรายการรูปแบบผิด · ไม่มีชื่อ = ใช้ id', () => {
  expect(
    parseXaiVoices({
      voices: [{ voice_id: 'eve' }, { name: 'x' }, 'bad', { voice_id: 'rex', name: 'Rex' }],
    }),
  ).toEqual([
    { id: 'eve', name: 'eve' },
    { id: 'rex', name: 'Rex' },
  ]);
  expect(parseXaiVoices(null)).toEqual([]);
});
