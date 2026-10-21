import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { whileMounted } from '../utils';
import { FieldLabel } from './ui';

interface OptionInputProps {
  /** ProviderSettings option scope, e.g. 'tts.azure'. */
  scope: string;
  name: string;
  label: string;
  placeholder?: string | undefined;
}

/** Plain (non-secret) provider option, e.g. Azure region or a custom base URL. Saved on blur. */
export function OptionInput({ scope, name, label, placeholder }: OptionInputProps) {
  const [value, setValue] = useState('');

  useEffect(
    () =>
      whileMounted(
        () => ProviderSettings.getOption(scope, name),
        (v) => setValue(v ?? ''),
      ),
    [scope, name],
  );

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
