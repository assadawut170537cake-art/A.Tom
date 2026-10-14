import { memo, useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PERSONAS } from '../../constants';
import type { Persona } from '../../types';

const Dot = ({ delay, color }: { delay: number; color: string }) => {
  const y = useSharedValue(0);

  useEffect(() => {
    y.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(-4, { duration: 280 }), withTiming(0, { duration: 280 })),
        -1
      )
    );
    return () => cancelAnimation(y);
  }, [delay, y]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <Animated.View
      style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]}
    />
  );
};

interface TypingIndicatorProps {
  persona: Persona;
}

export const TypingIndicator = memo(function TypingIndicator({ persona }: TypingIndicatorProps) {
  const meta = PERSONAS[persona];
  return (
    <View className="mb-3 self-start" accessibilityLabel={`${meta.name} กำลังพิมพ์`}>
      <Text className="mb-1 text-[11px] font-medium text-white/60">{meta.name}</Text>
      <View className="flex-row items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white/[0.08] px-4 py-4">
        <Dot delay={0} color={meta.color} />
        <Dot delay={140} color={meta.color} />
        <Dot delay={280} color={meta.color} />
      </View>
    </View>
  );
});
