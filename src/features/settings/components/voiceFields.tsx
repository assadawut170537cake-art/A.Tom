import { secretKey } from '../../../core/storage/SecureKeyStore';
import { VOICE_PROVIDER_FIELDS } from '../../voice/voice.config';
import { ApiKeyInput } from './ApiKeyInput';
import { OptionInput } from './OptionInput';

const LABELS: Record<string, { label: string; placeholder?: string }> = {
  accessKeyId: { label: 'Access key ID', placeholder: 'AKIA…' },
  userId: { label: 'User ID' },
  region: { label: 'Region', placeholder: 'เช่น southeastasia / us-east-1' },
  baseURL: { label: 'Base URL', placeholder: 'https://host/v1' },
  model: { label: 'Model' },
};

/** Extra credentials/options some voice providers need beyond the main API key. */
export function VoiceExtraFields({ kind, id }: { kind: 'tts' | 'stt'; id: string }) {
  const fields = (VOICE_PROVIDER_FIELDS[kind] as Record<
    string,
    { secrets: readonly string[]; options: readonly string[] }
  >)[id];
  if (!fields) return null;
  return (
    <>
      {fields.secrets.map((name) => (
        <ApiKeyInput
          key={name}
          storageKey={secretKey(kind, id, name)}
          label={LABELS[name]?.label ?? name}
          placeholder={LABELS[name]?.placeholder}
        />
      ))}
      {fields.options.map((name) => (
        <OptionInput
          key={name}
          scope={`${kind}.${id}`}
          name={name}
          label={LABELS[name]?.label ?? name}
          placeholder={LABELS[name]?.placeholder}
        />
      ))}
    </>
  );
}
