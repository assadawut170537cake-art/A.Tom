import { KeyRound } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

interface ApiKeyNoticeProps {
  onPress: () => void;
}

/** แสดงเมื่อยังไม่มี LLM ตัวไหนที่เปิดอยู่และใส่ key แล้ว — แตะเพื่อไปหน้าตั้งค่า AI */
export function ApiKeyNotice({ onPress }: ApiKeyNoticeProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="ยังไม่ได้ตั้งค่า API key — ไปที่ ตั้งค่า › AI Providers"
      className="mb-2 flex-row items-center gap-2 self-center rounded-full border border-orange-400/30 bg-orange-500/15 px-3 py-1.5 active:bg-orange-500/25"
    >
      <KeyRound size={14} color="#fdba74" strokeWidth={2} />
      <Text className="text-xs text-orange-200">
        ยังไม่ได้ตั้งค่า API key — ไปที่ ตั้งค่า › AI Providers
      </Text>
    </Pressable>
  );
}
