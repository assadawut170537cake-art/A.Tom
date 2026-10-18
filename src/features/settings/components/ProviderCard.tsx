import { useEffect, useState } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import type { AIProvider } from '../../ai/core/types';
import { keyUrlFor } from '../constants/providerLinks';
import { modelListCache } from '../modelListCache';
import { whileMounted } from '../utils';
import { ApiKeyInput } from './ApiKeyInput';
import { ModelPicker } from './ModelPicker';
import { ProviderToggle } from './ProviderToggle';
import { TestConnectionButton } from './TestConnectionButton';
import { Card } from './ui';

interface ProviderCardProps {
  provider: AIProvider;
  subtitle?: string | undefined;
}

/** One AI provider: enable toggle, API key, model and connection test. */
export function ProviderCard({ provider, subtitle }: ProviderCardProps) {
  const { config } = provider;
  const keyName = secretKey('ai', config.id);
  const [enabled, setEnabled] = useState(config.enabled);
  const [model, setModel] = useState(config.defaultModel);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // นับทุกครั้งที่บันทึก/ลบ key → ใช้เป็น `key` ของ picker ให้ลืมรายชื่อ/error เดิม
  // (แก้ key ซ้ำ true → true ก็ต้อง reset จึงไม่ใช้ hasKey อย่างเดียว)
  const [keyVersion, setKeyVersion] = useState(0);

  useEffect(() => whileMounted(() => SecureKeyStore.has(keyName), setHasKey), [keyName]);

  useEffect(
    () =>
      whileMounted(
        () =>
          Promise.all([
            ProviderSettings.getEnabled(config.id),
            ProviderSettings.getModelFor(config.id),
          ]),
        ([savedEnabled, savedModel]) => {
          setEnabled(savedEnabled ?? config.enabled);
          if (savedModel) setModel(savedModel);
        }
      ),
    [config]
  );

  const toggle = (value: boolean) => {
    setEnabled(value);
    ProviderSettings.setEnabled(config.id, value);
  };

  const selectModel = (value: string) => {
    setModel(value);
    ProviderSettings.setModelFor(config.id, value);
  };

  // key ใหม่อาจเห็นโมเดลไม่เหมือนเดิม (คนละบัญชี/สิทธิ์) → ทิ้งรายชื่อที่ cache ไว้
  const keyChanged = (saved: boolean) => {
    modelListCache.invalidate(config.id);
    setHasKey(saved);
    setKeyVersion((v) => v + 1);
  };

  return (
    <Card>
      <ProviderToggle label={config.name} subtitle={subtitle} value={enabled} onChange={toggle} />
      <ApiKeyInput storageKey={keyName} keyUrl={keyUrlFor('ai', config.id)} onChange={keyChanged} />
      <ModelPicker
        key={keyVersion}
        provider={provider}
        value={model}
        hasKey={hasKey}
        onChange={selectModel}
      />
      <TestConnectionButton test={() => provider.testConnection()} />
    </Card>
  );
}
