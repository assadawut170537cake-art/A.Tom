import { Text, View } from 'react-native';

import { FONTS, PERSONAS, USER_NAME } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';

const timePrefix = (hour: number) => {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Up late';
};

interface IdleGreetingProps {
  top: number;
}

export function IdleGreeting({ top }: IdleGreetingProps) {
  const persona = PERSONAS[useAtomStore((s) => s.activePersona)];
  const prefix = timePrefix(new Date().getHours());

  return (
    <View pointerEvents="none" className="absolute left-0 right-0 items-center px-8" style={{ top }}>
      <Text className="text-center text-[26px] text-white" style={{ fontFamily: FONTS.serif }}>
        {prefix}, ลูกพี่, {USER_NAME}.
      </Text>
      <Text className="mt-2 text-center text-sm text-white/45">
        {persona.nameEn} พร้อมแล้ว · แตะที่ Orb เพื่อเริ่มคุย
      </Text>
    </View>
  );
}
