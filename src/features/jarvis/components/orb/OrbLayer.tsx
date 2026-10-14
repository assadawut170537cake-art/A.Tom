import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ANIMATION, LAYOUT } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import { OrbWebView } from './OrbWebView';

const { nativeSize, idleScale, conversationScale, idleCenterY, conversationTop } = LAYOUT.orb;

interface OrbLayerProps {
  onPress?: () => void;
}

/**
 * The Orb is always rendered at its native 180px; idle <-> conversation only
 * animates transform (translateY + scale) to avoid layout thrashing.
 */
export function OrbLayer({ onPress }: OrbLayerProps) {
  const persona = useAtomStore((s) => s.activePersona);
  const mood = useAtomStore((s) => s.mood);
  const isConversation = useAtomStore((s) => s.uiMode === 'conversation');

  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const areaHeight = height - insets.top - insets.bottom;

  // Idle layout: orb centred at idleCenterY of the safe area
  const idleTop = areaHeight * idleCenterY - nativeSize / 2;
  // Conversation: scaled orb's visual top edge sits at conversationTop (scale is around the centre)
  const conversationCenter = conversationTop + (nativeSize * conversationScale) / 2;
  const conversationY = conversationCenter - areaHeight * idleCenterY;

  const translateY = useSharedValue(isConversation ? conversationY : 0);
  const scale = useSharedValue(isConversation ? conversationScale : idleScale);
  const mounted = useRef(false);

  useEffect(() => {
    const ty = isConversation ? conversationY : 0;
    const sc = isConversation ? conversationScale : idleScale;
    if (!mounted.current) {
      mounted.current = true;
      translateY.value = ty;
      scale.value = sc;
      return;
    }
    translateY.value = withSpring(ty, ANIMATION.orbSpring);
    scale.value = withSpring(sc, ANIMATION.orbSpring);
  }, [isConversation, conversationY, translateY, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.layer, { top: idleTop }, animatedStyle]}>
      <OrbWebView persona={persona} mood={mood} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={isConversation ? 'กลับหน้าเลือกผู้ช่วย' : 'แตะเพื่อเริ่มคุย'}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    alignSelf: 'center',
    width: nativeSize,
    height: nativeSize,
    zIndex: 10,
  },
});
