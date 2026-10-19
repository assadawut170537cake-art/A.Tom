import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';

import {
  ProviderSettings,
  type VoiceIdOf,
  type VoiceKind,
} from '../../../core/storage/ProviderSettings';
import { voiceRegistry } from '../../voice/core/VoiceRegistry';
import { useStandbyStore } from '../../voice/live/standbyStore';
import { STT_PROVIDERS, TTS_PROVIDERS, type VoiceProviderMeta } from '../../voice/voice.config';
import { PriorityList } from '../components/PriorityList';
import { STTProviderCard } from '../components/STTProviderCard';
import { TTSProviderCard } from '../components/TTSProviderCard';
import { Card, Section } from '../components/ui';
import { mergeOrder, whileMounted } from '../utils';

const META: { [K in VoiceKind]: VoiceProviderMeta<VoiceIdOf[K]>[] } = {
  tts: TTS_PROVIDERS,
  stt: STT_PROVIDERS,
};

function useVoicePriority<K extends VoiceKind>(kind: K) {
  const meta: VoiceProviderMeta<VoiceIdOf[K]>[] = META[kind];
  const [order, setOrder] = useState<VoiceIdOf[K][]>(() => meta.map((p) => p.id));

  useEffect(
    () =>
      whileMounted(
        () => ProviderSettings.getVoicePriority(kind),
        (saved) => setOrder((current) => mergeOrder(saved, current))
      ),
    [kind]
  );

  const change = (ids: VoiceIdOf[K][]) => {
    setOrder(ids);
    ProviderSettings.setVoicePriority(kind, ids);
  };

  const names = new Map<string, string>(meta.map((p) => [p.id, p.name]));
  return { items: order.map((id) => ({ id, label: names.get(id) ?? id })), change };
}

/** โหมดเฝ้า (อัลตรอน) — ฟังตลอดแม้อยู่แอปอื่น · สั่งจากแชทได้ด้วย "เปิดโหมดเฝ้า" */
function StandbyToggle() {
  const enabled = useStandbyStore((s) => s.enabled);
  useEffect(() => void useStandbyStore.getState().load(), []);
  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm text-white">ฟังตลอด (โหมดเฝ้า)</Text>
        <Switch
          value={enabled}
          onValueChange={(on) => void useStandbyStore.getState().setEnabled(on)}
          accessibilityLabel="โหมดเฝ้า"
          trackColor={{ false: 'rgba(255,255,255,0.15)', true: '#C0392B' }}
          thumbColor="#fff"
        />
      </View>
    </Card>
  );
}

export function VoiceSettingsScreen() {
  const [dragging, setDragging] = useState(false);
  const ttsPriority = useVoicePriority('tts');
  const sttPriority = useVoicePriority('stt');

  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="p-4 pb-16"
      scrollEnabled={!dragging}
      keyboardShouldPersistTaps="handled"
    >
      <Section
        title="โหมดเฝ้า"
        hint="ไมค์ฟังตลอด (มีแจ้งเตือนค้าง) จนกว่าจะปิด · อยู่แอปอื่นให้เรียกชื่อก่อน เช่น “อัลตรอน ปรับเสียง 30” · ทุกประโยคที่ได้ยินถูกส่งถอดเสียง (เสียค่า STT)"
      >
        <StandbyToggle />
      </Section>
      <Section title="TTS — เสียงพูด" hint="Expo Speech ทำงานบนเครื่องและเป็นตัวสำรองสุดท้ายเสมอ">
        {TTS_PROVIDERS.map((meta) => {
          const provider = voiceRegistry.getTTS(meta.id);
          return provider ? <TTSProviderCard key={meta.id} provider={provider} meta={meta} /> : null;
        })}
      </Section>
      <Section title="STT — ถอดเสียง">
        {STT_PROVIDERS.map((meta) => {
          const provider = voiceRegistry.getSTT(meta.id);
          return provider ? <STTProviderCard key={meta.id} provider={provider} meta={meta} /> : null;
        })}
      </Section>
      <Section title="TTS Priority" hint="ใช้เมื่อเสียงของ persona ล้มเหลว — ตัวบนสุดถูกลองก่อน">
        <PriorityList items={ttsPriority.items} onChange={ttsPriority.change} onDragStateChange={setDragging} />
      </Section>
      <Section title="STT Priority">
        <PriorityList items={sttPriority.items} onChange={sttPriority.change} onDragStateChange={setDragging} />
      </Section>
    </ScrollView>
  );
}
