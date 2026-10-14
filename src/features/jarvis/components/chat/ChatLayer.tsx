import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ANIMATION, LAYOUT } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import { ChatList } from './ChatList';

interface ChatLayerProps {
  /** ระยะขอบล่างของรายการแชท — MainScreen ดันขึ้นเมื่อช่องพิมพ์สูงขึ้นหรือคีย์บอร์ดเปิด */
  bottom?: number;
}

export function ChatLayer({ bottom = LAYOUT.chat.bottomPadding }: ChatLayerProps) {
  const isConversation = useAtomStore((s) => s.uiMode === 'conversation');
  const progress = useSharedValue(isConversation ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isConversation ? 1 : 0, { duration: ANIMATION.chatFadeMs });
  }, [isConversation, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ANIMATION.chatOffsetY }],
  }));

  return (
    <Animated.View
      pointerEvents={isConversation ? 'auto' : 'none'}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: LAYOUT.chat.topPadding,
          bottom,
          zIndex: 5,
        },
        style,
      ]}
    >
      <ChatList />
    </Animated.View>
  );
}
