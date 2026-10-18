import { MessageSquarePlus, Search, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatTitle, type ChatArchive } from '../../../../core/storage/ChatArchiveStorage';
import { PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import { searchChats } from '../../utils/chatSearch';

const CURRENT_ID = '__current__';

const formatDate = (ts: number) => {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `วันนี้ ${time}` : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543} ${time}`;
};

interface ChatHistorySheetProps {
  visible: boolean;
  onClose: () => void;
}

/** ประวัติแชทของ persona ที่เลือกอยู่: ห้องปัจจุบัน + ห้องเก่า · ค้นหา · แชทใหม่ · ลบ (กดค้าง) */
export function ChatHistorySheet({ visible, onClose }: ChatHistorySheetProps) {
  const insets = useSafeAreaInsets();
  const persona = useAtomStore((s) => s.activePersona);
  const current = useAtomStore((s) => s.messagesByPersona[s.activePersona]);
  const archives = useAtomStore((s) => s.archivesByPersona[s.activePersona]);
  const [query, setQuery] = useState('');
  const meta = PERSONAS[persona];

  const hits = useMemo(() => {
    const currentChat: ChatArchive | null = current.some((m) => m.role !== 'system')
      ? {
          id: CURRENT_ID,
          title: chatTitle(current),
          createdAt: current[0]?.createdAt ?? 0,
          updatedAt: current.at(-1)?.createdAt ?? 0,
          messages: current,
        }
      : null;
    return searchChats(currentChat ? [currentChat, ...archives] : archives, query);
  }, [current, archives, query]);

  const enterConversation = () => {
    const store = useAtomStore.getState();
    if (store.uiMode === 'idle') store.setUIMode('conversation');
  };

  const open = (chat: ChatArchive) => {
    if (chat.id !== CURRENT_ID) useAtomStore.getState().openChat(persona, chat.id);
    enterConversation();
    onClose();
  };

  const startNew = () => {
    useAtomStore.getState().newChat(persona);
    enterConversation();
    onClose();
  };

  const confirmDelete = (chat: ChatArchive) => {
    if (chat.id === CURRENT_ID) return;
    Alert.alert('ลบห้องแชทนี้?', chat.title, [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบ', style: 'destructive', onPress: () => useAtomStore.getState().deleteChat(persona, chat.id) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-neutral-950 px-4" style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom }}>
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-white">ประวัติแชท · {meta.name}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text className="text-[15px] text-white/70">ปิด</Text>
          </Pressable>
        </View>

        <View className="mb-3 flex-row items-center gap-2 rounded-2xl bg-white/[0.08] px-3">
          <Search size={18} color="rgba(255,255,255,0.5)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="ค้นหาในแชท…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            className="flex-1 py-2.5 text-[15px] text-white"
            accessibilityLabel="ค้นหาในประวัติแชท"
          />
        </View>

        <Pressable
          onPress={startNew}
          accessibilityRole="button"
          className="mb-3 flex-row items-center gap-2 rounded-2xl px-3 py-3"
          style={{ backgroundColor: `${meta.color}33` }}
        >
          <MessageSquarePlus size={20} color={meta.color} />
          <Text className="text-[15px] font-medium text-white">แชทใหม่</Text>
        </Pressable>

        <FlatList
          data={hits}
          keyExtractor={(h) => h.chat.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text className="mt-8 text-center text-sm text-white/40">
              {query.trim() ? 'ไม่พบข้อความที่ค้นหา' : 'ยังไม่มีประวัติแชท'}
            </Text>
          }
          renderItem={({ item }) => {
            const isCurrent = item.chat.id === CURRENT_ID;
            return (
              <Pressable
                onPress={() => open(item.chat)}
                onLongPress={() => confirmDelete(item.chat)}
                accessibilityRole="button"
                accessibilityHint={isCurrent ? undefined : 'กดค้างเพื่อลบ'}
                className="mb-2 rounded-2xl bg-white/[0.05] px-3 py-3 active:bg-white/10"
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text numberOfLines={1} className="flex-1 text-[15px] text-white">
                    {item.chat.title}
                  </Text>
                  {isCurrent ? (
                    <Text className="text-xs" style={{ color: meta.color }}>
                      กำลังคุย
                    </Text>
                  ) : (
                    <Pressable onPress={() => confirmDelete(item.chat)} hitSlop={8} accessibilityLabel="ลบห้องแชท">
                      <Trash2 size={16} color="rgba(255,255,255,0.35)" />
                    </Pressable>
                  )}
                </View>
                {item.snippet ? (
                  <Text numberOfLines={2} className="mt-1 text-xs text-white/50">
                    {item.snippet}
                  </Text>
                ) : null}
                <Text className="mt-1 text-[11px] text-white/30">
                  {formatDate(item.chat.updatedAt)} · {item.chat.messages.length} ข้อความ
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
