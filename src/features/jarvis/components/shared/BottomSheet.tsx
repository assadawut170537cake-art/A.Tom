import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string | undefined;
  children: ReactNode;
}

/** แผ่นเมนูจากขอบล่าง (Modal ของ RN — ไม่ต้องเพิ่ม dependency) แตะพื้นหลังเพื่อปิด */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="ปิด" onPress={onClose} className="flex-1 bg-black/50" />
      <View
        className="rounded-t-3xl border-t border-white/10 bg-neutral-900 px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <View className="mb-2 h-1 w-10 self-center rounded-full bg-white/20" />
        {title ? <Text className="mb-2 text-base font-semibold text-white">{title}</Text> : null}
        {children}
      </View>
    </Modal>
  );
}

interface SheetItemProps {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hint?: string | undefined;
}

export function SheetItem({ label, icon, onPress, destructive = false, disabled = false, hint }: SheetItemProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-white/10"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      {icon}
      <View className="flex-1">
        <Text className={`text-[15px] ${destructive ? 'text-red-400' : 'text-white'}`}>{label}</Text>
        {hint ? <Text className="text-xs text-white/40">{hint}</Text> : null}
      </View>
    </Pressable>
  );
}
