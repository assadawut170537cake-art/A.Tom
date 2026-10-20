import { useCallback, useEffect, useRef } from 'react';
import { FlatList, type ListRenderItem } from 'react-native';

import { useAtomStore } from '../../stores/useAtomStore';
import type { Message } from '../../types';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';

const keyExtractor = (m: Message) => m.id;
const renderItem: ListRenderItem<Message> = ({ item }) => <ChatBubble message={item} />;

export function ChatList() {
  const activePersona = useAtomStore((s) => s.activePersona);
  const messages = useAtomStore((s) => s.messagesByPersona[s.activePersona]);
  const isThinking = useAtomStore((s) => s.mood === 'thinking');
  // คำตอบที่ AI กำลังพิมพ์ (สตรีม) ของ persona นี้ — แสดงเป็นบับเบิลสดแทนจุดพิมพ์
  const streaming = useAtomStore((s) =>
    s.streaming?.persona === s.activePersona && s.streaming.content.trim() ? s.streaming : null,
  );
  const listRef = useRef<FlatList<Message>>(null);

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
      ListFooterComponent={
        streaming !== null ? (
          <ChatBubble
            message={{
              id: 'streaming',
              persona: activePersona,
              role: 'assistant',
              content: streaming.content,
              createdAt: streaming.startedAt,
            }}
          />
        ) : isThinking ? (
          <TypingIndicator persona={activePersona} />
        ) : null
      }
      onContentSizeChange={scrollToEnd}
      contentContainerClassName="px-4 pt-2 pb-4"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}
