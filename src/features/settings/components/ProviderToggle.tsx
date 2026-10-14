import { Switch, Text, View } from 'react-native';

interface ProviderToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  subtitle?: string;
}

export function ProviderToggle({ label, value, onChange, subtitle }: ProviderToggleProps) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-white">{label}</Text>
        {subtitle && <Text className="mt-0.5 text-xs text-white/50">{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={`เปิดใช้ ${label}`}
        trackColor={{ false: 'rgba(255,255,255,0.15)', true: '#0ea5e9' }}
        thumbColor="#fff"
      />
    </View>
  );
}
