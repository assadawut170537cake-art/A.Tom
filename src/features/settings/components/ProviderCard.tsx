import { useEffect, useState } from 'react';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { secretKey } from '../../../core/storage/SecureKeyStore';
import type { AIProvider } from '../../ai/core/types';
import { whileMounted } from '../utils';
import { ApiKeyInput } from './ApiKeyInput';
import { ModelSelector, type SelectOption } from './ModelSelector';
import { ProviderToggle } from './ProviderToggle';
import { TestConnectionButton } from './TestConnectionButton';
import { Card } from './ui';

const toOptions = (models: string[]): SelectOption[] => models.map((m) => ({ value: m, label: m }));

interface ProviderCardProps {
  provider: AIProvider;
  subtitle?: string | undefined;
}

/** One AI provider: enable toggle, API key, model and connection test. */
export function ProviderCard({ provider, subtitle }: ProviderCardProps) {
  const { config } = provider;
  const [enabled, setEnabled] = useState(config.enabled);
  const [model, setModel] = useState(config.defaultModel);
  const [models, setModels] = useState<string[]>(
    config.models === 'dynamic' ? [config.defaultModel] : config.models
  );

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
          if (savedModel) {
            setModel(savedModel);
            setModels((list) => (list.includes(savedModel) ? list : [savedModel, ...list]));
          }
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

  const refreshModels = async () => {
    const live = await provider.getModels();
    if (live.length) setModels(live.includes(model) ? live : [model, ...live]);
  };

  return (
    <Card>
      <ProviderToggle label={config.name} subtitle={subtitle} value={enabled} onChange={toggle} />
      <ApiKeyInput storageKey={secretKey('ai', config.id)} />
      <ModelSelector
        label="โมเดล"
        value={model}
        options={toOptions(models)}
        onChange={selectModel}
        onRefresh={refreshModels}
      />
      <TestConnectionButton test={() => provider.testConnection()} />
    </Card>
  );
}
