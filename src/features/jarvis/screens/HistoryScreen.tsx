import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View, type ListRenderItem } from 'react-native';

import { PERSONA_IDS, type Persona } from '../../../core/types/persona';
import type { RootScreenProps } from '../../../navigation/types';
import { PERSONAS, USER_NAME } from '../constants';
import { useAtomStore } from '../stores/useAtomStore';
import type { Message } from '../types';

const EMPTY_HISTORY: Message[] = [];

const timeOf = (at: number) => {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()}/${d.getMonth() + 1} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * ประวัติการสนทนา (ปุ่มนาฬิกาซ้ายบนของหน้าหลัก) — ดูย้อนหลังแยกตาม persona · คุยต่อ · ล้างประวัติ (ยืนยันก่อน)
 * ข้อมูลเดียวกับที่แชทหน้าหลักใช้ (`messagesByPersona` · บันทึกด้วย ChatHistoryStorage)
 */
export function HistoryScreen({ navigation }: RootScreenProps<'History'>) {
  const activePersona = useAtomStore((s) => s.activePersona);
  const [persona, setPersona] = useState<Persona>(activePersona);
  const messages = useAtomStore((s) => s.messagesByPersona[persona] ?? EMPTY_HISTORY);
  const info = PERSONAS[persona];

  const continueChat = () => {
    const store = useAtomStore.getState();
    store.setActivePersona(persona);
    store.setUIMode('conversation');
    navigation.goBack();
  };

  const clear = () =>
    Alert.alert(
      `ล้างประวัติของ${info.name}?`,
      'ลบข้อความของ persona นี้ในมือถือเครื่องนี้ (กู้คืนไม่ได้) · ถ้าจับคู่ห้องแชทกับ Mark 55 ไว้ ข้อความฝั่ง PC ยังอยู่ และอาจซิงก์กลับมาเมื่อจับคู่ใหม่',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ล้าง',
          style: 'destructive',
          onPress: () => useAtomStore.getState().clearHistory(persona),
        },
      ],
    );

  const renderItem: ListRenderItem<Message> = ({ item }) => {
    const who = item.role === 'user' ? USER_NAME : item.role === 'assistant' ? info.name : 'ระบบ';
    return (
      <View className="gap-1 border-b border-white/5 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-xs font-semibold"
            style={{ color: item.role === 'assistant' ? info.color : 'rgba(255,255,255,0.6)' }}
          >
            {who}
          </Text>
          <Text className="text-[11px] text-white/40">{timeOf(item.createdAt)}</Text>
        </View>
        <Text className="text-sm leading-5 text-white/90">{item.content}</Text>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-[#05060a]">
      <View className="flex-row gap-2 px-4 py-3" accessibilityRole="tablist">
        {PERSONA_IDS.map((p) => {
          const selected = p === persona;
          return (
            <Pressable
              key={p}
              onPress={() => setPersona(p)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={PERSONAS[p].name}
              className="flex-1 items-center rounded-full border px-2 py-2"
              style={{
                borderColor: selected ? PERSONAS[p].color : 'rgba(255,255,255,0.12)',
                backgroundColor: selected ? `${PERSONAS[p].color}22` : 'transparent',
              }}
            >
              <Text className="text-xs font-semibold text-white" numberOfLines={1}>
                {PERSONAS[p].name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text className="px-4 py-10 text-center text-sm text-white/50">
            ยังไม่มีบทสนทนากับ{info.name}
          </Text>
        }
      />

      <View className="flex-row gap-3 border-t border-white/10 p-4">
        <Pressable
          onPress={continueChat}
          accessibilityRole="button"
          accessibilityLabel={`คุยต่อกับ${info.name}`}
          className="flex-1 items-center rounded-2xl py-3 active:opacity-80"
          style={{ backgroundColor: info.color }}
        >
          <Text className="text-sm font-semibold text-white">คุยต่อกับ{info.name}</Text>
        </Pressable>
        <Pressable
          onPress={clear}
          disabled={messages.length === 0}
          accessibilityRole="button"
          accessibilityLabel="ล้างประวัติ"
          className="items-center rounded-2xl border border-white/15 px-5 py-3 active:bg-white/10"
          style={{ opacity: messages.length === 0 ? 0.4 : 1 }}
        >
          <Text className="text-sm text-white/80">ล้าง</Text>
        </Pressable>
      </View>
    </View>
  );
}
