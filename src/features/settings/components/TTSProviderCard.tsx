import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { secretKey } from '../../../core/storage/SecureKeyStore';
import type { TTSProvider, TTSProviderId, Voice } from '../../voice/core/types';
import type { VoiceProviderMeta } from '../../voice/voice.config';
import { whileMounted } from '../utils';
import { ApiKeyInput } from './ApiKeyInput';
import { ModelSelector } from './ModelSelector';
import { ProviderToggle } from './ProviderToggle';
import { TestConnectionButton } from './TestConnectionButton';
import { Card, SmallButton } from './ui';
import { PREVIEW_TEXT, voiceOptions } from './voiceOptions';
import { VoiceExtraFields } from './voiceFields';

interface TTSProviderCardProps {
  provider: TTSProvider;
  meta: VoiceProviderMeta<TTSProviderId>;
}

/** One TTS provider: enable, credentials, default voice, connection test and a voice preview. */
export function TTSProviderCard({ provider, meta }: TTSProviderCardProps) {
  const scope = `tts.${provider.id}`;
  const [enabled, setEnabled] = useState(true);
  const [voiceId, setVoiceId] = useState<string | undefined>();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(
    () =>
      whileMounted(
        () =>
          Promise.all([
            ProviderSettings.getVoiceEnabled('tts', provider.id),
            ProviderSettings.getOption(scope, 'voiceId'),
          ]),
        ([e, v]) => {
          setEnabled(e);
          setVoiceId(v || undefined);
        }
      ),
    [provider.id, scope]
  );

  const toggle = (value: boolean) => {
    setEnabled(value);
    ProviderSettings.setVoiceEnabled('tts', provider.id, value);
  };

  const selectVoice = (value: string) => {
    setVoiceId(value);
    ProviderSettings.setOption(scope, 'voiceId', value);
  };

  const preview = async () => {
    setPreviewError(null);
    setPreviewing(true);
    try {
      await provider.speak(PREVIEW_TEXT, { voiceId });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const options = voiceOptions(voices, voiceId);

  return (
    <Card>
      <ProviderToggle
        label={meta.name}
        subtitle={meta.isDefault ? 'ค่าเริ่มต้น · ไม่ต้องใช้ key' : undefined}
        value={enabled}
        onChange={toggle}
      />
      {meta.requiresKey && <ApiKeyInput storageKey={secretKey('tts', provider.id)} />}
      <VoiceExtraFields kind="tts" id={provider.id} />
      <ModelSelector
        label="เสียงเริ่มต้น"
        value={voiceId}
        options={options}
        placeholder="ค่าเริ่มต้นของผู้ให้บริการ"
        onChange={selectVoice}
        onRefresh={async () => setVoices(await provider.getVoices())}
      />
      <View className="flex-row flex-wrap items-start gap-3">
        <View className="flex-1">
          <TestConnectionButton test={() => provider.testConnection()} />
        </View>
        <SmallButton
          label={previewing ? 'หยุด' : 'ลองฟัง'}
          onPress={previewing ? () => provider.stop() : preview}
        />
      </View>
      {previewError && <Text className="text-xs text-red-300">{previewError}</Text>}
    </Card>
  );
}
