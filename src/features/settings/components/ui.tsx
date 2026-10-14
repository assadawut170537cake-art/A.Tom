import type { ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps } from 'react-native';

/** Shared building blocks for the settings screens (dark NativeWind theme, matches the main screen). */

interface SectionProps {
  title: string;
  hint?: string | undefined;
  children: ReactNode;
}

interface ChildrenProps {
  children: ReactNode;
}

export function Section({ title, hint, children }: SectionProps) {
  return (
    <View className="mb-7">
      <Text className="mb-1 px-1 text-xs font-semibold uppercase tracking-widest text-white/50">
        {title}
      </Text>
      {hint && <Text className="mb-2 px-1 text-xs text-white/40">{hint}</Text>}
      <View className="gap-3">{children}</View>
    </View>
  );
}

export function Card({ children }: ChildrenProps) {
  return <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">{children}</View>;
}

export function FieldLabel({ children }: ChildrenProps) {
  return <Text className="mb-1.5 text-xs font-medium text-white/60">{children}</Text>;
}

type Tone = 'default' | 'primary' | 'danger';

const TONES: Record<Tone, string> = {
  default: 'border-white/15 bg-white/10 active:bg-white/20',
  primary: 'border-sky-400/40 bg-sky-500/25 active:bg-sky-500/40',
  danger: 'border-red-400/30 bg-red-500/15 active:bg-red-500/30',
};

interface SmallButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  tone?: Tone | undefined;
}

export function SmallButton({
  label,
  tone = 'default',
  disabled,
  ...rest
}: SmallButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      className={`rounded-xl border px-3.5 py-2 ${TONES[tone]} ${disabled ? 'opacity-40' : ''}`}
      {...rest}
    >
      <Text className="text-center text-[13px] font-medium text-white">{label}</Text>
    </Pressable>
  );
}
