import { ScrollView } from 'react-native';

import { PersonaVoiceMapper } from '../components/PersonaVoiceMapper';
import { Section } from '../components/ui';

export function PersonaVoiceScreen() {
  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="p-4 pb-16"
      keyboardShouldPersistTaps="handled"
    >
      <Section
        title="เสียงของแต่ละผู้ช่วย"
        hint="เปลี่ยน persona แล้วเสียงจะเปลี่ยนตามอัตโนมัติ — ถ้าผู้ให้บริการล้ม จะใช้ TTS Priority แทน"
      >
        <PersonaVoiceMapper />
      </Section>
    </ScrollView>
  );
}
