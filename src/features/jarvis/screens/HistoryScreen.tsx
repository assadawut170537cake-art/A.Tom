import { ChevronLeft, MessageSquare } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, SectionList, Text, View } from 'react-native';

import { PERSONA_IDS, type Persona } from '../../../core/types/persona';
import type { RootScreenProps } from '../../../navigation/types';
import { ChatBubble } from '../components/chat/ChatBubble';
import { PERSONAS } from '../constants';
import { dayLabel, groupConversations, type Conversation } from '../history';
import { useAtomStore } from '../stores/useAtomStore';

type Filter = Persona | 'all';

const timeOf = (at: number) => {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * ประวัติการสนทนา (ปุ่มนาฬิกาซ้ายบน) — แบบรายการแชทของ Claude (Boss ขอ 2026-10-21):
 * รายการหัวข้อ (แบ่งบทสนทนาจากช่วงเงียบ · `history.ts`) จัดกลุ่มตามวัน → แตะ = อ่านทั้งบทสนทนา → คุยต่อ / ลบ
 */
export function HistoryScreen({ navigation }: RootScreenProps<'History'>) {
  const messagesByPersona = useAtomStore((s) => s.messagesByPersona);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const conversations = useMemo(() => {
    const personas = filter === 'all' ? PERSONA_IDS : [filter];
    return personas
      .flatMap((p) => groupConversations(messagesByPersona[p]))
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [messagesByPersona, filter]);

  const sections = useMemo(() => {
    const out: { title: string; data: Conversation[] }[] = [];
    for (const c of conversations) {
      const title = dayLabel(c.lastAt);
      const last = out[out.length - 1];
      if (last?.title === title) last.data.push(c);
      else out.push({ title, data: [c] });
    }
    return out;
  }, [conversations]);

  const open = conversations.find((c) => c.id === openId) ?? null;

  const continueChat = (persona: Persona) => {
    const store = useAtomStore.getState();
    store.setActivePersona(persona);
    store.setUIMode('conversation');
    navigation.goBack();
  };

  const remove = (c: Conversation) =>
    Alert.alert(
      'ลบบทสนทนานี้?',
      'ลบเฉพาะในมือถือเครื่องนี้ (กู้คืนไม่ได้) · ถ้าจับคู่ห้องแชทกับ Mark 55 ไว้ สำเนาฝั่ง PC ยังอยู่',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: () => {
            useAtomStore.getState().removeMessages(
              c.persona,
              c.messages.map((m) => m.id),
            );
            setOpenId(null);
          },
        },
      ],
    );

  if (open) {
    const info = PERSONAS[open.persona];
    return (
      <View className="flex-1 bg-[#05060a]">
        <Pressable
          onPress={() => setOpenId(null)}
          accessibilityRole="button"
          accessibilityLabel="กลับไปรายการ"
          className="flex-row items-center gap-1 px-3 py-3"
        >
          <ChevronLeft size={18} color="rgba(255,255,255,0.7)" />
          <Text className="flex-1 text-sm font-semibold text-white" numberOfLines={1}>
            {open.title}
          </Text>
        </Pressable>
        <FlatList
          data={open.messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <ChatBubble message={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        />
        <View className="flex-row gap-3 border-t border-white/10 p-4">
          <Pressable
            onPress={() => continueChat(open.persona)}
            accessibilityRole="button"
            accessibilityLabel={`คุยต่อกับ${info.name}`}
            className="flex-1 items-center rounded-2xl py-3 active:opacity-80"
            style={{ backgroundColor: info.color }}
          >
            <Text className="text-sm font-semibold text-white">คุยต่อกับ{info.name}</Text>
          </Pressable>
          <Pressable
            onPress={() => remove(open)}
            accessibilityRole="button"
            accessibilityLabel="ลบบทสนทนานี้"
            className="items-center rounded-2xl border border-white/15 px-5 py-3 active:bg-white/10"
          >
            <Text className="text-sm text-white/80">ลบ</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const chips: Filter[] = ['all', ...PERSONA_IDS];
  return (
    <View className="flex-1 bg-[#05060a]">
      <View className="flex-row gap-2 px-4 py-3" accessibilityRole="tablist">
        {chips.map((f) => {
          const selected = f === filter;
          const color = f === 'all' ? '#ffffff' : PERSONAS[f].color;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={f === 'all' ? 'ทั้งหมด' : PERSONAS[f].name}
              className="flex-1 items-center rounded-full border px-1 py-2"
              style={{
                borderColor: selected ? color : 'rgba(255,255,255,0.12)',
                backgroundColor: selected ? `${color}22` : 'transparent',
              }}
            >
              <Text className="text-xs font-semibold text-white" numberOfLines={1}>
                {f === 'all' ? 'ทั้งหมด' : PERSONAS[f].name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text className="px-4 pb-1 pt-4 text-xs font-semibold text-white/45">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const info = PERSONAS[item.persona];
          return (
            <Pressable
              onPress={() => setOpenId(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`เปิดบทสนทนา ${item.title}`}
              className="mx-3 flex-row items-center gap-3 rounded-2xl px-3 py-3 active:bg-white/5"
            >
              <View
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: `${info.color}33` }}
              >
                <MessageSquare size={16} color={info.color} />
              </View>
              <View className="flex-1">
                <Text className="text-[15px] text-white" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-xs text-white/45" numberOfLines={1}>
                  {`${info.name} · ${timeOf(item.lastAt)} · ${item.preview}`}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text className="px-4 py-10 text-center text-sm text-white/50">
            {filter === 'all' ? 'ยังไม่มีบทสนทนา' : `ยังไม่มีบทสนทนากับ${PERSONAS[filter].name}`}
          </Text>
        }
      />
    </View>
  );
}
