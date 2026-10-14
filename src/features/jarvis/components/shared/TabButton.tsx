import type { LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, Text } from 'react-native';

interface TabButtonProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  accentColor: string;
  onPress: () => void;
}

export const TabButton = memo(function TabButton({
  label,
  icon: Icon,
  active,
  accentColor,
  onPress,
}: TabButtonProps) {
  const color = active ? accentColor : 'rgba(255,255,255,0.45)';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      className="flex-1 items-center justify-center gap-1 py-2 active:opacity-70"
    >
      <Icon size={22} color={color} strokeWidth={active ? 2.2 : 1.8} />
      <Text className="text-[11px] font-medium" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
});
