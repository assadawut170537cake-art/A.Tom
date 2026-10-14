import type { LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable } from 'react-native';

interface ActionButtonProps {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress?: (() => void) | undefined;
  size?: number;
  disabled?: boolean;
}

export const ActionButton = memo(function ActionButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  size = 52,
  disabled,
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      className="items-center justify-center rounded-full border border-white/10 bg-white/10 active:bg-white/20"
      style={{ width: size, height: size, opacity: disabled ? 0.4 : 1 }}
    >
      <Icon size={22} color="rgba(255,255,255,0.85)" strokeWidth={1.8} />
    </Pressable>
  );
});
