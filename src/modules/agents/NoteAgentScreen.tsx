import { Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { AgentScreenProps } from '../../core/agents/types';
import { noteStore as defaultStore, type Note, type NoteStore } from './noteStore';

const pad = (n: number) => String(n).padStart(2, '0');

/** วัน/เดือน ชั่วโมง:นาที (ไม่ใช้ toLocaleString — Intl ของ Hermes บางรุ่นไม่มีภาษาไทย) */
const formatTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** UI ของ agent "โน้ต": รายการโน้ต (ใหม่สุดก่อน) + ปุ่มลบ · อัปเดตเองเมื่อมีโน้ตใหม่จากแชท */
export function NoteAgentScreen({ store = defaultStore }: AgentScreenProps & { store?: NoteStore }) {
  const [notes, setNotes] = useState<readonly Note[] | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = store.subscribe((next) => setNotes(next));
    store
      .list()
      .then((list) => {
        if (active) setNotes(list);
      })
      .catch((e: unknown) => {
        console.error('[agents] โหลดโน้ตไม่ได้', e);
        if (active) setNotes([]);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store]);

  if (!notes) return <Text className="p-3 text-sm text-white/50">กำลังโหลดโน้ต…</Text>;
  if (!notes.length) {
    return <Text className="p-3 text-sm text-white/50">ยังไม่มีโน้ต — ลองพิมพ์ “จดบันทึกว่า …”</Text>;
  }
  return (
    <FlatList
      data={notes}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => (
        <View className="flex-row items-start gap-2 border-b border-white/5 py-2">
          <View className="flex-1">
            <Text className="text-sm text-white">{item.text}</Text>
            <Text className="mt-0.5 text-xs text-white/40">{formatTime(item.createdAt)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`ลบโน้ต ${item.text}`}
            hitSlop={8}
            onPress={() => {
              store.remove(item.id).catch((e: unknown) => console.error('[agents] ลบโน้ตไม่ได้', e));
            }}
          >
            <Trash2 size={16} color="#ffffff80" />
          </Pressable>
        </View>
      )}
    />
  );
}
