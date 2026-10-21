import { memo } from 'react';
import { Image, Text, View } from 'react-native';

import { AttachmentChips } from '../../../attachments/components/AttachmentChips';
import { PERSONAS, USER_NAME } from '../../constants';
import type { Message } from '../../types';

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface ChatBubbleProps {
  message: Message;
}

export const ChatBubble = memo(function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const persona = PERSONAS[message.persona];

  if (message.role === 'system') {
    return (
      <Text className="mb-3 self-center text-center text-xs text-white/40">{message.content}</Text>
    );
  }

  return (
    <View className={isUser ? 'mb-3 max-w-[80%] self-end' : 'mb-3 max-w-[80%] self-start'}>
      <View className={`mb-1 flex-row items-center gap-1.5 ${isUser ? 'self-end' : 'self-start'}`}>
        {!isUser && (
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: persona.color }} />
        )}
        <Text className="text-[11px] font-medium text-white/60">
          {isUser ? USER_NAME : persona.name}
        </Text>
        <Text className="text-[11px] text-white/35">{formatTime(message.createdAt)}</Text>
      </View>
      <View
        className={
          isUser
            ? 'rounded-2xl rounded-br-sm bg-blue-600/80 px-4 py-3'
            : 'rounded-2xl rounded-bl-sm bg-white/[0.08] px-4 py-3'
        }
      >
        <Text className="text-[15px] leading-6 text-white">{message.content}</Text>
        {message.attachments && (
          <View className="mt-2">
            <AttachmentChips files={message.attachments} />
          </View>
        )}
        {message.imageUri ? (
          <Image
            source={{ uri: message.imageUri }}
            accessibilityLabel="รูปที่ผู้ช่วยสร้างหรือแนบมา"
            resizeMode="contain"
            style={{ width: 240, height: 240, borderRadius: 12, marginTop: 8 }}
          />
        ) : null}
      </View>
    </View>
  );
});
