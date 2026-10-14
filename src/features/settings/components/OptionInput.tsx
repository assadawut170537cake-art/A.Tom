import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { FieldLabel } from './ui';

interface OptionInputProps {
  /** ProviderSettings option scope, e.g. 'tts.azure'. */
  scope: string;
  name: string;
  label: string;
  placeholder?: string;
}

/** Plain (non-secret) provider option, e.g. Azure region or a custom base URL. Saved on blur. */
export function OptionInput({ scope, name, label, placeholder }: OptionInputProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    let alive = true;
    ProviderSettings.getOption(scope, name).then((v) => alive && setValue(v ?? ''));
    return () => {
      alive = false;
    };
  }, [scope, name]);

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={setValue}
        onEndEditing={() => ProviderSettings.setOption(scope, name, value.trim())}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        className="rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
      />
    </View>
  );
}
