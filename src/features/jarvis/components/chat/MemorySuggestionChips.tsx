import { Brain } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { acceptMemorySuggestion, dismissMemorySuggestion } from '../../services/conversation';
import type { Message } from '../../types';

interface MemorySuggestionChipsProps {
  message: Message;
  accent: string;
}

/** "จำไว้ไหม?" ใต้คำตอบ — ผู้ช่วยเสนอ บอสตัดสิน (ไม่บันทึกเองเงียบ ๆ) */
export function MemorySuggestionChips({ message, accent }: MemorySuggestionChipsProps) {
  const [failed, setFailed] = useState(false);
  const suggestions = message.memorySuggestions ?? [];
  if (!suggestions.length) return null;
  return (
    <View className="mt-2 gap-2">
      {suggestions.map((s) => (
        <View key={s.key} className="flex-row items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
          <Brain size={14} color={accent} />
          <Text className="flex-1 text-[13px] text-white/80" numberOfLines={2}>
            จำไว้ไหม: {s.value}
          </Text>
          <Pressable
            onPress={() => {
              void acceptMemorySuggestion(message, s.key).then((ok) => setFailed(!ok));
            }}
            accessibilityRole="button"
            accessibilityLabel={`จำ ${s.value}`}
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: accent }}
          >
            <Text className="text-xs font-medium text-white">จำ</Text>
          </Pressable>
          <Pressable
            onPress={() => dismissMemorySuggestion(message, s.key)}
            accessibilityRole="button"
            accessibilityLabel={`ไม่ต้องจำ ${s.value}`}
            className="rounded-full border border-white/20 px-3 py-1"
          >
            <Text className="text-xs text-white/70">ไม่ต้อง</Text>
          </Pressable>
        </View>
      ))}
      {failed && <Text className="text-[11px] text-red-300">บันทึกความจำไม่สำเร็จ — ลองใหม่อีกครั้ง</Text>}
    </View>
  );
}
