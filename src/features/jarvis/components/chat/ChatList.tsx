import { useCallback, useEffect, useRef } from 'react';
import { FlatList, type ListRenderItem } from 'react-native';

import { useAtomStore } from '../../stores/useAtomStore';
import type { Message } from '../../types';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';

const keyExtractor = (m: Message) => m.id;

interface ChatListProps {
  onMessageLongPress?: ((message: Message) => void) | undefined;
}

export function ChatList({ onMessageLongPress }: ChatListProps) {
  const activePersona = useAtomStore((s) => s.activePersona);
  const messages = useAtomStore((s) => s.messagesByPersona[s.activePersona]);
  // คำตอบกำลังไหลเข้ามาแล้ว = ไม่ต้องแสดงจุด "กำลังพิมพ์"
  const isThinking = useAtomStore((s) => s.mood === 'thinking' && !s.streamingId);
  const listRef = useRef<FlatList<Message>>(null);
  const renderItem: ListRenderItem<Message> = useCallback(
    ({ item }) => <ChatBubble message={item} onLongPress={onMessageLongPress} />,
    [onMessageLongPress]
  );

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Jump to the latest message when switching persona (history swaps in)
  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, [activePersona]);

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListFooterComponent={isThinking ? <TypingIndicator persona={activePersona} /> : null}
      onContentSizeChange={scrollToEnd}
      contentContainerClassName="px-4 pt-2 pb-4"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}
