import {
  BookOpen,
  Camera,
  FileCode,
  Image as ImageIcon,
  Puzzle,
  Search,
  type LucideIcon,
} from 'lucide-react-native';
import { Modal, Pressable, Text, View } from 'react-native';

export type AddMenuAction =
  'images' | 'camera' | 'files' | 'research' | 'notebooklm' | 'marketplace';

interface Item {
  action: AddMenuAction;
  icon: LucideIcon;
  label: string;
  hint: string;
}

const ITEMS: Item[] = [
  { action: 'images', icon: ImageIcon, label: 'รูปภาพ', hint: 'เลือกจากคลังรูป (ได้หลายรูป)' },
  { action: 'camera', icon: Camera, label: 'ถ่ายรูป', hint: 'เปิดกล้องแล้วแนบเลย' },
  {
    action: 'files',
    icon: FileCode,
    label: 'ไฟล์ / โค้ด',
    hint: 'PDF · เอกสาร · ไฟล์โค้ด · เสียง · วิดีโอ',
  },
  { action: 'research', icon: Search, label: 'ค้นคว้า', hint: 'ฝากงานให้ผู้ช่วยค้นแล้วสรุปกลับมา' },
  {
    action: 'notebooklm',
    icon: BookOpen,
    label: 'ส่งเข้า NotebookLM',
    hint: 'ลิงก์ / YouTube / ข้อความ ผ่าน Mark 55',
  },
  { action: 'marketplace', icon: Puzzle, label: 'ปลั๊กอิน & ทักษะ', hint: 'เปิด Marketplace' },
];

interface AddMenuProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: AddMenuAction) => void;
}

/** เมนูปุ่ม + (Boss ขอ 2026-10-20): แนบรูป/ไฟล์ทุกแบบ + ทางลัด ค้นคว้า · NotebookLM · ปลั๊กอิน/ทักษะ */
export function AddMenu({ visible, onClose, onSelect }: AddMenuProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/50"
        onPress={onClose}
        accessibilityLabel="ปิดเมนูเพิ่ม"
      />
      <View className="rounded-t-3xl border-t border-white/10 bg-[#0d0f16] px-4 pb-8 pt-3">
        <View className="mb-3 h-1 w-10 self-center rounded-full bg-white/20" />
        {ITEMS.map(({ action, icon: Icon, label, hint }) => (
          <Pressable
            key={action}
            onPress={() => {
              onClose();
              onSelect(action);
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            className="flex-row items-center gap-3 rounded-2xl px-2 py-3 active:bg-white/10"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-white/10">
              <Icon size={19} color="rgba(255,255,255,0.9)" strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] text-white">{label}</Text>
              <Text className="text-xs text-white/45">{hint}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
