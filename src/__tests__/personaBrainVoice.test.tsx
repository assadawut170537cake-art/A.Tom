import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProviderSettings } from '../core/storage/ProviderSettings';
import { PersonaLLMMapper } from '../features/settings/components/PersonaLLMMapper';
import { nth } from '../test-utils/nth';
import { registerAll, resetSettings } from '../test-utils/setup';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderMapper = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PersonaLLMMapper />
    </SafeAreaProvider>,
  );

beforeAll(registerAll);
beforeEach(async () => {
  await resetSettings();
  for (const p of [1, 2, 3, 4] as const) await ProviderSettings.setLLMFor(p, undefined);
  await ProviderSettings.setEnabled('dahl-glm', false);
});

test('แต่ละ persona เลือกสมองกับเสียงแยกกัน — ค่าบันทึกแยกช่อง', async () => {
  await renderMapper();
  // อัลตรอน (ตัวที่ 4): สมอง = Dahl GLM
  const brains = await screen.findAllByLabelText(/🧠 สมอง \(ประมวลผล\)/);
  expect(brains).toHaveLength(4);
  await fireEvent.press(nth(brains, 3));
  await fireEvent.press(screen.getByText('Dahl · GLM 5.3 Flash'));
  await waitFor(async () => expect(await ProviderSettings.getLLMFor(4)).toBe('dahl-glm'));
  expect(await ProviderSettings.getEnabled('dahl-glm')).toBe(true); // เลือกแล้วเปิดให้

  // อัลตรอน: เสียง = Gemini TTS (ไม่กระทบสมอง)
  const voices = screen.getAllByLabelText(/🔊 เสียง \(พูด\)/);
  await fireEvent.press(nth(voices, 3));
  await fireEvent.press(screen.getByText('Gemini TTS'));
  await waitFor(async () =>
    expect((await ProviderSettings.getTTSFor(4))?.providerId).toBe('gemini'),
  );
  expect(await ProviderSettings.getLLMFor(4)).toBe('dahl-glm');
  expect(await ProviderSettings.getLLMFor(1)).toBeUndefined(); // persona อื่นไม่โดน
});

test('ใช้เสียงเดียวกันทุกตัว → แสดงเฉย ๆ ไม่มีตัวเลือกเสียงต่อ persona', async () => {
  await ProviderSettings.setSameVoiceForAll(true);
  await ProviderSettings.setSharedVoice({ providerId: 'expo' });
  await renderMapper();
  await screen.findAllByLabelText(/🧠 สมอง/);
  expect(screen.queryAllByLabelText(/🔊 เสียง \(พูด\)/)).toHaveLength(0);
  expect(screen.getAllByText(/ใช้เสียงเดียวกันทุก persona/)).toHaveLength(4);
});
