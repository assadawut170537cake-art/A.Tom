import { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { LAYOUT, PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';

export function ListeningIndicator() {
  const isListening = useAtomStore((s) => s.mood === 'listening');
  const color = PERSONAS[useAtomStore((s) => s.activePersona)].color;
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!isListening) return;
    pulse.value = withRepeat(withTiming(1.06, { duration: 600 }), -1, true);
    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [isListening, pulse]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  if (!isListening) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: LAYOUT.actionBar.bottom + 72,
          alignItems: 'center',
          zIndex: 8,
        },
        style,
      ]}
    >
      <Text className="text-sm font-medium tracking-[3px]" style={{ color }}>
        ···· Listening... ····
      </Text>
    </Animated.View>
  );
}
