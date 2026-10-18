import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PERSONAS, USER_NAME } from '../../constants';
import type { Message } from '../../types';
import { AttachmentStrip } from './AttachmentStrip';
import { MarkdownText } from './MarkdownText';

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface ChatBubbleProps {
  message: Message;
  /** กดค้าง → เมนู คัดลอก / แชร์ / ตอบใหม่ / แก้ไข / ลบ */
  onLongPress?: ((message: Message) => void) | undefined;
}

/**
 * ข้อความระบบ (error) แสดงแค่บรรทัดแรก — รายละเอียด (รายชื่อผู้ให้บริการที่ล้มทุกเจ้า) ยาวเต็มจอ
 * จึงซ่อนไว้ แตะเพื่อดู
 */
function SystemNotice({ message, onLongPress }: ChatBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [first = '', ...rest] = message.content.split('\n');
  const hasMore = rest.some((line) => line.trim());
  return (
    <Pressable
      onPress={hasMore ? () => setExpanded((v) => !v) : undefined}
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      accessibilityRole={hasMore ? 'button' : 'text'}
      accessibilityHint={hasMore ? 'แตะเพื่อดูรายละเอียด' : undefined}
      className="mb-3 max-w-[90%] self-center"
    >
      <Text className="text-center text-xs text-white/50">{first}</Text>
      {hasMore && !expanded && <Text className="mt-0.5 text-center text-[11px] text-white/30">แตะเพื่อดูรายละเอียด</Text>}
      {expanded && <Text className="mt-1 text-center text-[11px] leading-4 text-white/35">{rest.join('\n').trim()}</Text>}
    </Pressable>
  );
}

export const ChatBubble = memo(function ChatBubble({ message, onLongPress }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const persona = PERSONAS[message.persona];

  if (message.role === 'system') return <SystemNotice message={message} onLongPress={onLongPress} />;

  return (
    <View className={isUser ? 'mb-3 max-w-[85%] self-end' : 'mb-3 max-w-[90%] self-start'}>
      <View className={`mb-1 flex-row items-center gap-1.5 ${isUser ? 'self-end' : 'self-start'}`}>
        {!isUser && (
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: persona.color }} />
        )}
        <Text className="text-[11px] font-medium text-white/60">
          {isUser ? USER_NAME : persona.name}
        </Text>
        <Text className="text-[11px] text-white/35">{formatTime(message.createdAt)}</Text>
      </View>
      <Pressable
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}
        delayLongPress={350}
        accessibilityHint="กดค้างเพื่อคัดลอก แชร์ หรือแก้ไข"
        className={
          isUser
            ? 'rounded-2xl rounded-br-sm bg-blue-600/80 px-4 py-3'
            : 'rounded-2xl rounded-bl-sm bg-white/[0.08] px-4 py-3'
        }
      >
        {message.attachments?.length ? (
          <View className={message.content ? 'mb-2' : ''}>
            <AttachmentStrip attachments={message.attachments} size={140} />
          </View>
        ) : null}
        {isUser ? (
          message.content ? <Text className="text-[15px] leading-6 text-white">{message.content}</Text> : null
        ) : (
          <MarkdownText text={message.content} accent={persona.color} />
        )}
      </Pressable>
    </View>
  );
});
