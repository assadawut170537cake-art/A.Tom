import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import {
  DEFAULT_ADVANCED,
  ProviderSettings,
  type AdvancedSettings,
} from '../../../core/storage/ProviderSettings';
import { aiRegistry } from '../../ai/core/ProviderRegistry';
import type { AIProviderId } from '../../ai/core/types';
import { PriorityList } from '../components/PriorityList';
import { ProviderCard } from '../components/ProviderCard';
import { ProviderToggle } from '../components/ProviderToggle';
import { Card, FieldLabel, Section, SmallButton } from '../components/ui';
import { mergeOrder, whileMounted } from '../utils';

const MAX_RETRIES = 3;

function useLLMPriority() {
  const llm = aiRegistry.list().filter((p) => (p.config.purpose ?? 'llm') === 'llm');
  const [order, setOrder] = useState<AIProviderId[]>(llm.map((p) => p.config.id));

  useEffect(
    () =>
      whileMounted(ProviderSettings.getPriority, (saved) =>
        setOrder((current) => mergeOrder(saved, current))
      ),
    []
  );

  const change = (ids: string[]) => {
    setOrder(ids as AIProviderId[]);
    ProviderSettings.setPriority(ids as AIProviderId[]);
  };

  const items = order.map((id) => {
    const p = aiRegistry.get(id);
    return { id, label: p?.config.name ?? id, subtitle: p?.config.defaultModel };
  });
  return { items, change };
}

function AdvancedSection() {
  const [adv, setAdv] = useState<AdvancedSettings>(DEFAULT_ADVANCED);
  const [timeoutText, setTimeoutText] = useState(String(DEFAULT_ADVANCED.timeoutMs / 1000));

  useEffect(
    () =>
      whileMounted(ProviderSettings.getAdvanced, (a) => {
        setAdv(a);
        setTimeoutText(String(a.timeoutMs / 1000));
      }),
    []
  );

  const patch = (p: Partial<AdvancedSettings>) => {
    setAdv((a) => ({ ...a, ...p }));
    ProviderSettings.setAdvanced(p);
  };

  const commitTimeout = () => {
    const seconds = Math.max(5, Math.min(120, Math.round(Number(timeoutText) || 30)));
    setTimeoutText(String(seconds));
    patch({ timeoutMs: seconds * 1000 });
  };

  return (
    <Card>
      <View>
        <FieldLabel>Timeout ต่อคำขอ (วินาที, 5–120)</FieldLabel>
        <TextInput
          value={timeoutText}
          onChangeText={setTimeoutText}
          onEndEditing={commitTimeout}
          keyboardType="number-pad"
          accessibilityLabel="Timeout เป็นวินาที"
          className="w-24 rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
        />
      </View>
      <View>
        <FieldLabel>Retry ผู้ให้บริการเดิม (เมื่อ 429/5xx/timeout)</FieldLabel>
        <View className="flex-row items-center gap-3">
          <SmallButton
            label="−"
            accessibilityLabel="ลดจำนวน retry"
            disabled={adv.retries <= 0}
            onPress={() => patch({ retries: adv.retries - 1 })}
          />
          <Text className="w-8 text-center text-base text-white">{adv.retries}</Text>
          <SmallButton
            label="+"
            accessibilityLabel="เพิ่มจำนวน retry"
            disabled={adv.retries >= MAX_RETRIES}
            onPress={() => patch({ retries: adv.retries + 1 })}
          />
        </View>
      </View>
      <ProviderToggle
        label="Fallback อัตโนมัติ"
        subtitle="ถ้าผู้ให้บริการแรกล้ม ให้ลองตัวถัดไปตามลำดับ"
        value={adv.fallback}
        onChange={(fallback) => patch({ fallback })}
      />
    </Card>
  );
}

export function AISettingsScreen() {
  const [dragging, setDragging] = useState(false);
  const priority = useLLMPriority();
  const gemini = aiRegistry.get('gemini');
  const openrouter = aiRegistry.get('openrouter');
  const jev = aiRegistry.get('jev');

  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="p-4 pb-16"
      scrollEnabled={!dragging}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="LLM Providers">
        {gemini && <ProviderCard provider={gemini} />}
        {openrouter && <ProviderCard provider={openrouter} subtitle="โมเดลจาก OpenRouter (โหลดรายการได้)" />}
      </Section>
      <Section title="Router" hint="Jev จัดประเภทคำสั่ง (intent) ก่อนส่งให้ LLM — ไม่ได้ใช้ตอบแชท">
        {jev && <ProviderCard provider={jev} subtitle="TypeSafe System One" />}
      </Section>
      <Section title="Priority" hint="ลากที่ไอคอน ⋮⋮ หรือกด ↑↓ — ตัวบนสุดถูกเรียกก่อน">
        <PriorityList items={priority.items} onChange={priority.change} onDragStateChange={setDragging} />
      </Section>
      <Section title="Advanced">
        <AdvancedSection />
      </Section>
    </ScrollView>
  );
}
