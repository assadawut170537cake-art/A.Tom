import * as Clipboard from 'expo-clipboard';
import { Copy, Pencil, RefreshCw, Share2, Trash2, Volume2 } from 'lucide-react-native';
import { Share } from 'react-native';

import { editMessage, regenerate, speakMessage } from '../../services/conversation';
import { useAtomStore } from '../../stores/useAtomStore';
import type { Message } from '../../types';
import { stripMarkdown } from '../../utils/markdown';
import { BottomSheet, SheetItem } from '../shared/BottomSheet';

const ICON = { size: 20, color: 'rgba(255,255,255,0.8)' } as const;

interface MessageActionSheetProps {
  message: Message | null;
  onClose: () => void;
  /** ผู้ช่วยกำลังคิด/พูด — ห้ามตอบใหม่/แก้ไขซ้อนรอบที่กำลังทำงาน */
  busy: boolean;
}

export function MessageActionSheet({ message, onClose, busy }: MessageActionSheetProps) {
  if (!message) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const isAssistant = message.role === 'assistant';
  const isUser = message.role === 'user';

  return (
    <BottomSheet visible onClose={onClose}>
      <SheetItem
        label="คัดลอก"
        icon={<Copy {...ICON} />}
        onPress={run(() => void Clipboard.setStringAsync(message.content))}
      />
      <SheetItem
        label="แชร์"
        icon={<Share2 {...ICON} />}
        onPress={run(() => void Share.share({ message: isAssistant ? stripMarkdown(message.content) : message.content }).catch(() => undefined))}
      />
      {isAssistant && (
        <SheetItem label="อ่านออกเสียง" icon={<Volume2 {...ICON} />} onPress={run(() => speakMessage(message))} />
      )}
      {isAssistant && (
        <SheetItem
          label="ตอบใหม่"
          hint="ลบคำตอบนี้ (และข้อความหลังจากนี้) แล้วถามคำถามเดิมอีกรอบ"
          icon={<RefreshCw {...ICON} />}
          disabled={busy}
          onPress={run(() => void regenerate(message))}
        />
      )}
      {isUser && (
        <SheetItem
          label="แก้ไข"
          hint="ลบข้อความนี้และที่ตามมา แล้วนำกลับไปแก้ในช่องพิมพ์"
          icon={<Pencil {...ICON} />}
          disabled={busy}
          onPress={run(() => editMessage(message))}
        />
      )}
      <SheetItem
        label="ลบข้อความนี้"
        destructive
        icon={<Trash2 size={20} color="#f87171" />}
        disabled={busy}
        onPress={run(() => useAtomStore.getState().removeMessage(message.persona, message.id))}
      />
    </BottomSheet>
  );
}
