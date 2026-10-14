import { Clock, Settings } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { LAYOUT, PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';

interface HeaderProps {
  onHistory?: () => void;
  onSettings?: () => void;
}

export function Header({ onHistory, onSettings }: HeaderProps) {
  const persona = PERSONAS[useAtomStore((s) => s.activePersona)];

  return (
    <View
      className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
      style={{ height: LAYOUT.header.height, zIndex: 30 }}
    >
      <Pressable
        onPress={onHistory}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="ประวัติ"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-white/10"
      >
        <Clock size={20} color="rgba(255,255,255,0.75)" />
      </Pressable>

      <Text className="text-base font-semibold tracking-wide text-white" accessibilityRole="header">
        {persona.name}
      </Text>

      <Pressable
        onPress={onSettings}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="ตั้งค่า"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-white/10"
      >
        <Settings size={20} color="rgba(255,255,255,0.75)" />
      </Pressable>
    </View>
  );
}
