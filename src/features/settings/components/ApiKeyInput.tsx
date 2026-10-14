import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { SecureKeyStore } from '../../../core/storage/SecureKeyStore';
import { whileMounted } from '../utils';
import { FieldLabel, SmallButton } from './ui';

interface ApiKeyInputProps {
  /** SecureKeyStore key, e.g. secretKey('ai', 'gemini'). */
  storageKey: string;
  label?: string;
  placeholder?: string;
  onChange?: (hasKey: boolean) => void;
}

/** Write-only secret field: the saved value is never read back into the UI, only its presence. */
export function ApiKeyInput({ storageKey, label = 'API key', placeholder, onChange }: ApiKeyInputProps) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(
    () => whileMounted(() => SecureKeyStore.has(storageKey), setHasKey),
    [storageKey]
  );

  const save = async () => {
    const value = draft.trim();
    if (!value) return;
    await SecureKeyStore.set(storageKey, value);
    setDraft('');
    setEditing(false);
    setHasKey(true);
    onChange?.(true);
  };

  const remove = async () => {
    await SecureKeyStore.delete(storageKey);
    setHasKey(false);
    onChange?.(false);
  };

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      {hasKey && !editing ? (
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-sm text-emerald-300" accessibilityLabel={`${label} บันทึกแล้ว`}>
            ✓ บันทึกแล้ว ••••••
          </Text>
          <SmallButton label="แก้ไข" onPress={() => setEditing(true)} />
          <SmallButton label="ลบ" tone="danger" onPress={remove} />
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder ?? 'วาง key ที่นี่'}
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={label}
            onSubmitEditing={save}
            className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
          />
          <SmallButton label="บันทึก" tone="primary" disabled={!draft.trim()} onPress={save} />
          {editing && <SmallButton label="ยกเลิก" onPress={() => setEditing(false)} />}
        </View>
      )}
    </View>
  );
}
