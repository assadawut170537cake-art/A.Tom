import { DEFAULT_PERSONA_VOICE_MAP, ProviderSettings } from '../core/storage/ProviderSettings';
import { DEFAULT_PERSONA_VOICE_MAP as FROM_CONFIG } from '../features/voice/voice.config';

// ไฟล์แยกจาก personaVoiceMap.test เพราะที่นั่น beforeEach ตั้งเสียงทุก persona ไว้แล้ว
// (ProviderSettings ไม่มีทางลบค่า persona) — ที่นี่ module registry สดใหม่ = ยังไม่มี user setting

const PERSONAS = [1, 2, 3, 4] as const;

describe('DEFAULT_PERSONA_VOICE_MAP', () => {
  test('ไม่มี user setting → resolveVoiceFor คืนค่าเริ่มต้น ไม่ใช่ undefined และต่างกันทั้ง 4 persona', async () => {
    const resolved = await Promise.all(PERSONAS.map((p) => ProviderSettings.resolveVoiceFor(p)));
    expect(resolved).toEqual(PERSONAS.map((p) => DEFAULT_PERSONA_VOICE_MAP[p]));
    expect(new Set(resolved.map((v) => `${v?.pitch}/${v?.speed}`)).size).toBe(4);
    expect(FROM_CONFIG).toBe(DEFAULT_PERSONA_VOICE_MAP);
  });

  test('ค่าที่คืนเป็นสำเนา — แก้แล้วไม่กระทบค่าเริ่มต้น', async () => {
    const v = await ProviderSettings.resolveVoiceFor(1);
    if (v) v.pitch = 9;
    expect(DEFAULT_PERSONA_VOICE_MAP[1].pitch).not.toBe(9);
  });

  test('user setting ชนะค่าเริ่มต้น เฉพาะ persona ที่ตั้ง', async () => {
    await ProviderSettings.setTTSFor(2, { providerId: 'openai', voiceId: 'onyx' });
    await expect(ProviderSettings.resolveVoiceFor(2)).resolves.toEqual({
      providerId: 'openai',
      voiceId: 'onyx',
    });
    await expect(ProviderSettings.resolveVoiceFor(3)).resolves.toEqual(
      DEFAULT_PERSONA_VOICE_MAP[3],
    );
  });

  test('"same voice for all" ยังชนะค่าเริ่มต้น', async () => {
    await ProviderSettings.setSharedVoice({ providerId: 'azure', voiceId: 'th-TH-NiwatNeural' });
    await ProviderSettings.setSameVoiceForAll(true);
    await expect(ProviderSettings.resolveVoiceFor(1)).resolves.toMatchObject({
      providerId: 'azure',
    });
  });
});
