import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ProviderSettings, type PersonaVoice } from '../../../core/storage/ProviderSettings';
import { PERSONA_IDS, type Persona } from '../../../core/types/persona';
import type { TTSProviderId } from '../../../core/types/voiceProvider';
import { aiRegistry } from '../../ai/core/ProviderRegistry';
import type { AIProviderId } from '../../ai/core/types';
import { PERSONAS } from '../../jarvis/constants';
import { TTS_PROVIDERS } from '../../voice/voice.config';
import { whileMounted } from '../utils';
import { ModelSelector, type SelectOption } from './ModelSelector';
import { Card } from './ui';

/** ค่าพิเศษใน dropdown = ไม่ผูก (สลับเองตาม Priority) */
export const AUTO_LLM = 'auto';
type Choice = AIProviderId | typeof AUTO_LLM;

interface Loaded {
  brain: Partial<Record<Persona, AIProviderId>>;
  voice: Partial<Record<Persona, PersonaVoice>>;
  sameVoice: boolean;
}

const loadAll = async (): Promise<Loaded> => {
  const brain: Loaded['brain'] = {};
  const voice: Loaded['voice'] = {};
  await Promise.all(
    PERSONA_IDS.map(async (p) => {
      const id = await ProviderSettings.getLLMFor(p);
      if (id) brain[p] = id;
      const v = await ProviderSettings.resolveVoiceFor(p);
      if (v) voice[p] = v;
    }),
  );
  return { brain, voice, sameVoice: await ProviderSettings.getSameVoiceForAll() };
};

const VOICE_OPTIONS: SelectOption<TTSProviderId>[] = TTS_PROVIDERS.map((p) => ({
  value: p.id,
  label: p.name,
  hint: p.requiresKey ? 'ต้องใช้ API key (ตั้งค่า › เสียง)' : 'บนเครื่อง · ไม่ใช้โควต้า',
}));

/**
 * แยก "สมอง" กับ "เสียง" ต่อ persona (Boss ขอ) — โมเดลที่คิดคำตอบ กับตัวที่พูดออกเสียง เลือกคนละตัวได้
 * - สมอง: "อัตโนมัติ" = Priority + ตัวที่ตอบได้ล่าสุด · เลือกตัวไหน = ลองตัวนั้นก่อน ล้มยังสลับเอง · เลือกแล้วเปิด provider ให้
 * - เสียง: เปลี่ยนผู้ให้บริการ TTS ของ persona (ล้างเสียงที่เลือกไว้ เพราะ id เสียงใช้ข้ามเจ้าไม่ได้) — เลือกเสียงละเอียด
 *   ที่ ตั้งค่า › เสียงของ Persona · "ใช้เสียงเดียวกันทุกตัว" เปิดอยู่ = แสดงอย่างเดียว
 */
export function PersonaLLMMapper() {
  const [state, setState] = useState<Loaded>({ brain: {}, voice: {}, sameVoice: false });
  useEffect(() => whileMounted(loadAll, setState), []);

  const brainOptions: SelectOption<Choice>[] = [
    { value: AUTO_LLM, label: 'อัตโนมัติ', hint: 'สลับเองตามลำดับ Priority' },
    ...aiRegistry
      .list()
      .filter((p) => (p.config.purpose ?? 'llm') === 'llm')
      .map((p) => ({ value: p.config.id, label: p.config.name, hint: p.config.defaultModel })),
  ];

  const changeBrain = (persona: Persona, choice: Choice) => {
    const id = choice === AUTO_LLM ? undefined : choice;
    setState((cur) => {
      const brain = { ...cur.brain };
      if (id) brain[persona] = id;
      else delete brain[persona];
      return { ...cur, brain };
    });
    ProviderSettings.setLLMFor(persona, id);
    // provider ที่ปิดอยู่ไม่ถูกเรียกเลย → เลือกแล้วเปิดให้ (ยังต้องใส่ key ในการ์ดของมันเอง)
    if (id) ProviderSettings.setEnabled(id, true);
  };

  const changeVoice = (persona: Persona, providerId: TTSProviderId) => {
    const current = state.voice[persona];
    if (current?.providerId === providerId) return;
    // เก็บ speed/pitch ไว้ · ล้าง voiceId (ชื่อเสียงของเจ้าหนึ่งใช้กับอีกเจ้าไม่ได้)
    const next: PersonaVoice = { ...current, providerId, voiceId: undefined };
    setState((cur) => ({ ...cur, voice: { ...cur.voice, [persona]: next } }));
    ProviderSettings.setTTSFor(persona, next);
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
            label="🧠 สมอง (ประมวลผล)"
            value={state.brain[p] ?? AUTO_LLM}
            options={brainOptions}
            onChange={(choice) => changeBrain(p, choice)}
          />
          {state.sameVoice ? (
            <Text className="text-xs text-white/50">
              🔊 เสียง: ใช้เสียงเดียวกันทุก persona ({state.voice[p]?.providerId ?? 'expo'}) —
              ปิดได้ที่ ตั้งค่า › เสียงของ Persona
            </Text>
          ) : (
            <ModelSelector<TTSProviderId>
              label="🔊 เสียง (พูด)"
              value={state.voice[p]?.providerId ?? 'expo'}
              options={VOICE_OPTIONS}
              onChange={(id) => changeVoice(p, id)}
            />
          )}
        </View>
      ))}
    </Card>
  );
}
