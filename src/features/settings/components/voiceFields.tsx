import { secretKey } from '../../../core/storage/SecureKeyStore';
import type { VoiceIdOf, VoiceKind } from '../../../core/storage/ProviderSettings';
import { voiceProviderFields, type VoiceFieldName } from '../../voice/voice.config';
import { ApiKeyInput } from './ApiKeyInput';
import { OptionInput } from './OptionInput';

const LABELS: Record<VoiceFieldName, { label: string; placeholder?: string | undefined }> = {
  accessKeyId: { label: 'Access key ID', placeholder: 'AKIA…' },
  userId: { label: 'User ID' },
  region: { label: 'Region', placeholder: 'เช่น southeastasia / us-east-1' },
  baseURL: { label: 'Base URL', placeholder: 'https://host/v1' },
  model: { label: 'Model' },
};

interface VoiceExtraFieldsProps<K extends VoiceKind> {
  kind: K;
  id: VoiceIdOf[K];
}

/** Extra credentials/options some voice providers need beyond the main API key. */
export function VoiceExtraFields<K extends VoiceKind>({ kind, id }: VoiceExtraFieldsProps<K>) {
  const fields = voiceProviderFields(kind, id);
  if (!fields) return null;
  return (
    <>
      {fields.secrets.map((name) => (
        <ApiKeyInput
          key={name}
          storageKey={secretKey(kind, id, name)}
          label={LABELS[name].label}
          placeholder={LABELS[name].placeholder}
        />
      ))}
      {fields.options.map((name) => (
        <OptionInput
          key={name}
          scope={`${kind}.${id}`}
          name={name}
          label={LABELS[name].label}
          placeholder={LABELS[name].placeholder}
        />
      ))}
    </>
  );
}
