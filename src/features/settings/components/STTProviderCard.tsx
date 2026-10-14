import { useEffect, useState } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { secretKey } from '../../../core/storage/SecureKeyStore';
import type { STTProvider, STTProviderId } from '../../voice/core/types';
import type { VoiceProviderMeta } from '../../voice/voice.config';
import { ApiKeyInput } from './ApiKeyInput';
import { ProviderToggle } from './ProviderToggle';
import { TestConnectionButton } from './TestConnectionButton';
import { Card } from './ui';
import { VoiceExtraFields } from './voiceFields';

/** One STT provider: enable, credentials and connection test. */
export function STTProviderCard({
  provider,
  meta,
}: {
  provider: STTProvider;
  meta: VoiceProviderMeta<STTProviderId>;
}) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    ProviderSettings.getVoiceEnabled('stt', provider.id).then((e) => alive && setEnabled(e));
    return () => {
      alive = false;
    };
  }, [provider.id]);

  const toggle = (value: boolean) => {
    setEnabled(value);
    ProviderSettings.setVoiceEnabled('stt', provider.id, value);
  };

  return (
    <Card>
      <ProviderToggle
        label={meta.name}
        subtitle={meta.isDefault ? 'บนเครื่อง · ยังไม่รองรับ (ต้องใช้ development build)' : undefined}
        value={enabled}
        onChange={toggle}
      />
      {meta.requiresKey && <ApiKeyInput storageKey={secretKey('stt', provider.id)} />}
      <VoiceExtraFields kind="stt" id={provider.id} />
      <TestConnectionButton test={() => provider.testConnection()} />
    </Card>
  );
}
