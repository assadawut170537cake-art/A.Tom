import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { ProviderSettings, type VoiceKind } from '../../../core/storage/ProviderSettings';
import { voiceRegistry } from '../../voice/core/VoiceRegistry';
import type { STTProviderId, TTSProviderId } from '../../voice/core/types';
import { STT_PROVIDERS, TTS_PROVIDERS } from '../../voice/voice.config';
import { PriorityList } from '../components/PriorityList';
import { STTProviderCard } from '../components/STTProviderCard';
import { TTSProviderCard } from '../components/TTSProviderCard';
import { Section } from '../components/ui';
import { mergeOrder, whileMounted } from '../utils';

const META = { tts: TTS_PROVIDERS, stt: STT_PROVIDERS } as const;

function useVoicePriority(kind: VoiceKind) {
  const [order, setOrder] = useState<string[]>(META[kind].map((p) => p.id));

  useEffect(
    () =>
      whileMounted(
        (): Promise<string[]> => ProviderSettings.getVoicePriority(kind),
        (saved) => setOrder((current) => mergeOrder(saved, current))
      ),
    [kind]
  );

  const change = (ids: string[]) => {
    setOrder(ids);
    ProviderSettings.setVoicePriority(kind, ids as (TTSProviderId | STTProviderId)[]);
  };

  const names = new Map<string, string>(META[kind].map((p) => [p.id, p.name]));
  return { items: order.map((id) => ({ id, label: names.get(id) ?? id })), change };
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
