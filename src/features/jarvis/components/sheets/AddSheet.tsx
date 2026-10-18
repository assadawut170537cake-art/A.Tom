import { Camera, FileText, ImageIcon, MessageSquarePlus } from 'lucide-react-native';
import { Alert } from 'react-native';

import type { Attachment } from '../../../../core/types/message';
import { AttachmentError, MAX_ATTACHMENTS, pickDocument, pickImage, takePhoto } from '../../services/attachments';
import { useAtomStore } from '../../stores/useAtomStore';
import { BottomSheet, SheetItem } from '../shared/BottomSheet';

const ICON = { size: 20, color: 'rgba(255,255,255,0.8)' } as const;

interface AddSheetProps {
  visible: boolean;
  onClose: () => void;
  /** แนบไฟล์สำเร็จ (เช่นโฟกัสช่องพิมพ์ให้พิมพ์คำถามต่อ) */
  onAttached?: (() => void) | undefined;
}

/** เลือกไฟล์แล้วใส่รายการรอส่ง · error (ไม่ได้สิทธิ์กล้อง / ไฟล์ใหญ่) แจ้งเป็น Alert ภาษาไทย */
async function attach(pick: () => Promise<Attachment | null>, onAttached?: () => void) {
  const store = useAtomStore.getState();
  if (store.pendingAttachments.length >= MAX_ATTACHMENTS) {
    Alert.alert('แนบได้สูงสุด 4 ไฟล์ต่อข้อความ');
    return;
  }
  try {
    const attachment = await pick();
    if (!attachment) return;
    store.addPendingAttachment(attachment);
    if (store.uiMode === 'idle') store.setUIMode('conversation');
    onAttached?.();
  } catch (e) {
    Alert.alert('แนบไฟล์ไม่ได้', e instanceof AttachmentError ? e.message : 'ลองใหม่อีกครั้ง');
  }
}

/** เมนูปุ่ม ＋ ด้านล่าง: แชทใหม่ · แนบรูป · ถ่ายรูป · แนบไฟล์ */
export function AddSheet({ visible, onClose, onAttached }: AddSheetProps) {
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="เพิ่ม">
      <SheetItem
        label="แชทใหม่"
        hint="เก็บแชทนี้ไว้ในประวัติ แล้วเริ่มห้องใหม่"
        icon={<MessageSquarePlus {...ICON} />}
        onPress={run(() => {
          const store = useAtomStore.getState();
          store.newChat();
          if (store.uiMode === 'idle') store.setUIMode('conversation');
        })}
      />
      <SheetItem
        label="รูปภาพ"
        hint="เลือกรูปให้ AI ดู"
        icon={<ImageIcon {...ICON} />}
        onPress={run(() => void attach(pickImage, onAttached))}
      />
      <SheetItem
        label="ถ่ายรูป"
        icon={<Camera {...ICON} />}
        onPress={run(() => void attach(takePhoto, onAttached))}
      />
      <SheetItem
        label="ไฟล์ / PDF"
        hint="ให้ AI อ่านหรือสรุปเอกสาร (ไม่เกิน 15MB)"
        icon={<FileText {...ICON} />}
        onPress={run(() => void attach(pickDocument, onAttached))}
      />
    </BottomSheet>
  );
}
