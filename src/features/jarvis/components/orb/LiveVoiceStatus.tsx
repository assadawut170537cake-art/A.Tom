import { Text, View } from 'react-native';

import { LIVE_STATE_LABEL, type LiveVoiceState } from '../../../voice/live/LiveVoiceSession';

interface LiveVoiceStatusProps {
  state: LiveVoiceState;
  color: string;
  /** โหมดเฝ้า — บอกว่าอยู่แอปอื่นต้องเรียกชื่อก่อน */
  standby?: boolean | undefined;
}

/** ป้ายสถานะโหมดคุยด้วยเสียง (เหนือช่องพิมพ์) — วางใน flow ของ composer รายการแชทจึงถูกดันขึ้นเอง */
export function LiveVoiceStatus({ state, color, standby }: LiveVoiceStatusProps) {
  if (state === 'idle') return null;
  const label = LIVE_STATE_LABEL[state];
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${standby ? 'โหมดเฝ้า' : 'โหมดคุยด้วยเสียง'}: ${label}`}
      className="mb-2 flex-row items-center justify-center gap-2 self-center rounded-full border border-white/10 bg-white/[0.08] px-4 py-1.5"
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-sm font-medium text-white/90">
        {standby ? `เฝ้าอยู่ · ${label}` : label}
      </Text>
      <Text className="text-xs text-white/40">
        {standby ? '· อยู่แอปอื่นให้เรียกชื่อก่อน' : '· แตะ Orb เพื่อหยุด'}
      </Text>
    </View>
  );
}
