import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { PERSONA_IDS, type Persona } from '../../../core/types/persona';
import { aiRegistry } from '../../ai/core/ProviderRegistry';
import type { AIProviderId } from '../../ai/core/types';
import { PERSONAS } from '../../jarvis/constants';
import { whileMounted } from '../utils';
import { ModelSelector, type SelectOption } from './ModelSelector';
import { Card } from './ui';

/** ค่าพิเศษใน dropdown = ไม่ผูก (สลับเองตาม Priority) */
export const AUTO_LLM = 'auto';
type Choice = AIProviderId | typeof AUTO_LLM;

const loadAll = async () => {
  const entries = await Promise.all(
    PERSONA_IDS.map(async (p) => [p, await ProviderSettings.getLLMFor(p)] as const),
  );
  const out: Partial<Record<Persona, AIProviderId>> = {};
  for (const [p, id] of entries) if (id) out[p] = id;
  return out;
};

/**
 * เลือก LLM ต่อ persona (Boss ขอ) — "อัตโนมัติ" = ใช้ลำดับ Priority + ตัวที่ตอบได้ล่าสุด
 * เลือกตัวไหน = ลองตัวนั้นก่อน ล้มแล้วยังสลับไปตัวอื่นเอง (ถ้าเปิด Fallback) · เลือกแล้วเปิด provider ให้ด้วย
 */
export function PersonaLLMMapper() {
  const [byPersona, setByPersona] = useState<Partial<Record<Persona, AIProviderId>>>({});
  useEffect(() => whileMounted(loadAll, setByPersona), []);

  const options: SelectOption<Choice>[] = [
    { value: AUTO_LLM, label: 'อัตโนมัติ', hint: 'สลับเองตามลำดับ Priority' },
    ...aiRegistry
      .list()
      .filter((p) => (p.config.purpose ?? 'llm') === 'llm')
      .map((p) => ({ value: p.config.id, label: p.config.name, hint: p.config.defaultModel })),
  ];

  const change = (persona: Persona, choice: Choice) => {
    const id = choice === AUTO_LLM ? undefined : choice;
    setByPersona((cur) => {
      const next = { ...cur };
      if (id) next[persona] = id;
      else delete next[persona];
      return next;
    });
    ProviderSettings.setLLMFor(persona, id);
    // provider ที่ปิดอยู่ไม่ถูกเรียกเลย → เลือกแล้วเปิดให้ (ยังต้องใส่ key ในการ์ดของมันเอง)
    if (id) ProviderSettings.setEnabled(id, true);
  };

  return (
    <Card>
      {PERSONA_IDS.map((p) => (
        <View key={p} className="gap-1">
          <View className="flex-row items-center gap-2">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PERSONAS[p].color }}
            />
            <Text className="text-[15px] font-semibold text-white">{PERSONAS[p].name}</Text>
          </View>
          <ModelSelector<Choice>
            label="โมเดล AI"
            value={byPersona[p] ?? AUTO_LLM}
            options={options}
            onChange={(choice) => change(p, choice)}
          />
        </View>
      ))}
    </Card>
  );
}
