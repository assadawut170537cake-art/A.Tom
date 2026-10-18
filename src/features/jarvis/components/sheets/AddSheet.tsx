import { MessageSquarePlus } from 'lucide-react-native';

import { useAtomStore } from '../../stores/useAtomStore';
import { BottomSheet, SheetItem } from '../shared/BottomSheet';

const ICON = { size: 20, color: 'rgba(255,255,255,0.8)' } as const;

interface AddSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** เมนูปุ่ม ＋ ด้านล่าง: แชทใหม่ (+ แนบรูป/ไฟล์ — ชุดถัดไป) */
export function AddSheet({ visible, onClose }: AddSheetProps) {
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
    </BottomSheet>
  );
}
