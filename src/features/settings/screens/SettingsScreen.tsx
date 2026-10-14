import { ChevronRight, Cpu, Mic, Users, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RootScreenProps, RootStackParamList } from '../../../navigation/types';

interface Entry {
  route: Exclude<keyof RootStackParamList, 'Main' | 'Settings'>;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

const ENTRIES: Entry[] = [
  {
    route: 'AISettings',
    title: 'AI Providers',
    subtitle: 'Gemini · OpenRouter · Jev router · ลำดับความสำคัญ',
    icon: Cpu,
  },
  { route: 'VoiceSettings', title: 'Voice (TTS + STT)', subtitle: 'ผู้ให้บริการเสียงพูดและถอดเสียง', icon: Mic },
  { route: 'PersonaVoice', title: 'Persona Voice Map', subtitle: 'เสียงของแต่ละผู้ช่วย', icon: Users },
];

/** Settings hub. */
export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  return (
    <ScrollView className="flex-1 bg-[#05060a]" contentContainerClassName="gap-3 p-4">
      {ENTRIES.map(({ route, title, subtitle, icon: Icon }) => (
        <Pressable
          key={route}
          onPress={() => navigation.navigate(route)}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={subtitle}
          className="flex-row items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 active:bg-white/10"
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <Icon size={20} color="#fff" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-white">{title}</Text>
            <Text className="mt-0.5 text-xs text-white/50">{subtitle}</Text>
          </View>
          <ChevronRight size={18} color="rgba(255,255,255,0.4)" />
        </Pressable>
      ))}
    </ScrollView>
  );
}
