import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ProviderSettings, type PersonaVoice } from '../../../core/storage/ProviderSettings';
import { PERSONA_IDS, PERSONAS } from '../../jarvis/constants';
import { useAtomStore } from '../../jarvis/stores/useAtomStore';
import type { Persona } from '../../jarvis/types';
import { voiceRegistry } from '../../voice/core/VoiceRegistry';
import type { Voice } from '../../voice/core/types';
import { TTS_PROVIDERS } from '../../voice/voice.config';
import { whileMounted } from '../utils';
import { ModelSelector } from './ModelSelector';
import { ProviderToggle } from './ProviderToggle';
import { Card, SmallButton } from './ui';
import { PREVIEW_TEXT, voiceOptions } from './voiceOptions';

const DEFAULT_VOICE: PersonaVoice = { providerId: 'expo' };

const PROVIDER_OPTIONS = TTS_PROVIDERS.map((p) => ({
  value: p.id,
  label: p.name,
  hint: p.requiresKey ? 'ต้องใช้ API key' : 'บนเครื่อง · ไม่ต้องใช้ key',
}));

interface VoiceRowProps {
  title: string;
  color?: string;
  subtitle?: string;
  voice: PersonaVoice;
  onChange: (voice: PersonaVoice) => void;
}

/** Provider + voice picker for one persona (or for the shared voice). */
function VoiceRow({ title, color, subtitle, voice, onChange }: VoiceRowProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const provider = voiceRegistry.getTTS(voice.providerId);

  const options = voiceOptions(voices, voice.voiceId);

  const preview = async () => {
    setError(null);
    try {
      await provider?.speak(PREVIEW_TEXT, voice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <View className="flex-row items-center gap-2.5">
        {color && <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
        <Text className="flex-1 text-[15px] font-semibold text-white">{title}</Text>
        {subtitle && <Text className="text-xs text-white/40">{subtitle}</Text>}
      </View>
      <ModelSelector
        label="ผู้ให้บริการเสียง (TTS)"
        value={voice.providerId}
        options={PROVIDER_OPTIONS}
        onChange={(id) => {
          setVoices([]);
          onChange({ ...voice, providerId: id, voiceId: undefined });
        }}
      />
      <ModelSelector
        label="เสียง"
        value={voice.voiceId}
        options={options}
        placeholder="ค่าเริ่มต้นของผู้ให้บริการ"
        onChange={(voiceId) => onChange({ ...voice, voiceId })}
        onRefresh={async () => setVoices((await provider?.getVoices()) ?? [])}
      />
      <View className="flex-row">
        <SmallButton label="ลองฟัง" onPress={preview} disabled={!provider} />
      </View>
      {error && <Text className="text-xs text-red-300">{error}</Text>}
    </Card>
  );
}

/** Which TTS provider + voice each persona speaks with, or one voice for everyone. */
export function PersonaVoiceMapper() {
  const [loaded, setLoaded] = useState(false);
  const [same, setSame] = useState(false);
  const [shared, setShared] = useState<PersonaVoice>(DEFAULT_VOICE);
  const [byPersona, setByPersona] = useState<Partial<Record<Persona, PersonaVoice>>>({});

  useEffect(
    () =>
      whileMounted(
        () =>
          Promise.all([
            ProviderSettings.getSameVoiceForAll(),
            ProviderSettings.getSharedVoice(),
            Promise.all(PERSONA_IDS.map((p) => ProviderSettings.getTTSFor(p))),
          ]),
        ([s, sv, voices]) => {
          setSame(s);
          if (sv) setShared(sv);
          setByPersona(Object.fromEntries(PERSONA_IDS.map((p, i) => [p, voices[i]])));
          setLoaded(true);
        }
      ),
    []
  );

  // The active persona's voice lives in the store; re-resolve it after every change
  const refreshActiveVoice = () => useAtomStore.getState().refreshVoice();

  const toggleSame = async (value: boolean) => {
    setSame(value);
    await ProviderSettings.setSameVoiceForAll(value);
    if (value) await ProviderSettings.setSharedVoice(shared);
    await refreshActiveVoice();
  };

  const updateShared = async (voice: PersonaVoice) => {
    setShared(voice);
    await ProviderSettings.setSharedVoice(voice);
    await refreshActiveVoice();
  };

  const updatePersona = async (persona: Persona, voice: PersonaVoice) => {
    setByPersona((m) => ({ ...m, [persona]: voice }));
    await ProviderSettings.setTTSFor(persona, voice);
    await refreshActiveVoice();
  };

  if (!loaded) return null;

  return (
    <View className="gap-3">
      <Card>
        <ProviderToggle
          label="ใช้ voice เดียวกันทุก persona"
          subtitle="ปิดเพื่อตั้งเสียงแยกให้แต่ละผู้ช่วย"
          value={same}
          onChange={toggleSame}
        />
      </Card>
      {same ? (
        <VoiceRow title="ทุก persona" voice={shared} onChange={updateShared} />
      ) : (
        PERSONA_IDS.map((id) => (
          <VoiceRow
            key={id}
            title={PERSONAS[id].nameEn}
            subtitle={PERSONAS[id].name}
            color={PERSONAS[id].color}
            voice={byPersona[id] ?? DEFAULT_VOICE}
            onChange={(v) => updatePersona(id, v)}
          />
        ))
      )}
    </View>
  );
}
