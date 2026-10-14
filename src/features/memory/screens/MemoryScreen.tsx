import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View, type ListRenderItem } from 'react-native';

import { localMemory } from '../../../core/memory/LocalMemoryAdapter';
import type { MemoryStore } from '../../../core/memory/types';
import { LAYOUT, PERSONAS } from '../../jarvis/constants';
import { FactEditor } from '../components/FactEditor';
import {
  filterFacts,
  loadAllFacts,
  slotOf,
  sourceLabel,
  targetLabel,
  type FactDraft,
  type FactFilter,
  type ScopedFact,
} from '../factModel';

const ACCENT = PERSONAS[1].color;

const FILTERS: readonly { id: FactFilter; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'global', label: 'Global' },
  { id: 'persona', label: 'Persona' },
];

interface MemoryScreenProps {
  /** ค่าเริ่มต้น = Shared Memory ตัวเดียวกับที่ ChatHandler ใช้ (แก้ที่นี่ → แชทถัดไปเห็นทันที) */
  memory?: MemoryStore;
}

/**
 * แท็บ Memory: ดู/เพิ่ม/แก้/ลบ fact ใน Shared Memory
 * แตะ = แก้ไข · กดค้าง = ลบ (ถามยืนยัน) · ปุ่ม + = เพิ่ม
 */
export function MemoryScreen({ memory = localMemory }: MemoryScreenProps) {
  const [facts, setFacts] = useState<ScopedFact[] | null>(null);
  const [filter, setFilter] = useState<FactFilter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ScopedFact | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    loadAllFacts(memory)
      .then((list) => {
        if (!active) return;
        setFacts(list);
        setLoadError(false);
      })
      .catch((e: unknown) => {
        console.error('[memory] โหลดความจำไม่ได้', e);
        if (!active) return;
        setFacts([]);
        setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [memory, version]);

  const reload = () => setVersion((v) => v + 1);

  const openEditor = (fact: ScopedFact | null) => {
    setEditing(fact);
    setEditorOpen(true);
  };
  const closeEditor = () => setEditorOpen(false);

  const save = async ({ key, value, target }: FactDraft): Promise<string | null> => {
    const original = editing;
    const sameSlot = original !== null && slotOf(original.target, original.fact.key) === slotOf(target, key);
    try {
      // ย้าย key/ขอบเขต หรือเพิ่มใหม่ → ห้ามทับ fact อื่นที่มีอยู่แล้วโดยไม่ตั้งใจ
      if (!sameSlot && (await memory.load(target, key))) {
        return 'มีความจำ key นี้ในขอบเขตนี้แล้ว — แตะที่รายการนั้นเพื่อแก้ไขแทน';
      }
      await memory.save(target, key, value, 'user');
      if (original && !sameSlot) await memory.remove(original.target, original.fact.key);
    } catch (e) {
      console.error('[memory] บันทึกความจำไม่สำเร็จ', e);
      return 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง';
    }
    closeEditor();
    reload();
    return null;
  };

  const confirmDelete = useCallback(
    (item: ScopedFact) => {
      Alert.alert('ลบความจำนี้?', `${item.fact.key}: ${item.fact.value}`, [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: () => {
            memory
              .remove(item.target, item.fact.key)
              .catch((e: unknown) => console.error('[memory] ลบความจำไม่สำเร็จ', e))
              .finally(() => {
                setEditorOpen(false);
                setVersion((v) => v + 1);
              });
          },
        },
      ]);
    },
    [memory]
  );

  const visible = facts ? filterFacts(facts, filter) : [];

  const renderItem: ListRenderItem<ScopedFact> = ({ item }) => (
    <FactRow item={item} onPress={() => openEditor(item)} onLongPress={() => confirmDelete(item)} />
  );

  return (
    <View className="absolute inset-x-0 bottom-0" style={{ top: LAYOUT.header.height }}>
      <View className="px-4 pb-3 pt-2">
        <Text className="text-xl font-semibold text-white" accessibilityRole="header">
          ความจำของ A.T.O.M.
        </Text>
        <Text className="mt-1 text-xs text-white/45">
          ผู้ช่วยใช้ข้อมูลนี้ตอบบอสทุกครั้ง · แตะเพื่อแก้ไข · กดค้างเพื่อลบ
        </Text>
      </View>

      <View className="flex-row gap-2 px-4 pb-3" accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const selected = f.id === filter;
          const count = facts ? filterFacts(facts, f.id).length : 0;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={f.label}
              className="flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5"
              style={{
                borderColor: selected ? ACCENT : 'rgba(255,255,255,0.15)',
                backgroundColor: selected ? `${ACCENT}33` : 'transparent',
              }}
            >
              <Text className="text-xs font-medium text-white">{f.label}</Text>
              <Text className="text-[11px] text-white/50">{count}</Text>
            </Pressable>
          );
        })}
      </View>

      {loadError && (
        <Text className="px-4 pb-2 text-xs text-red-300" accessibilityRole="alert">
          อ่านความจำไม่ได้ — ลองปิดแล้วเปิดแท็บนี้ใหม่
        </Text>
      )}

      {facts !== null && (
        <FlatList
          data={visible}
          keyExtractor={(item) => slotOf(item.target, item.fact.key)}
          renderItem={renderItem}
          contentContainerClassName="gap-2 px-4"
          contentContainerStyle={{ paddingBottom: LAYOUT.actionBar.bottom + 72 }}
          ListEmptyComponent={
            <Text className="mt-16 text-center text-sm text-white/45">
              {facts.length === 0 ? 'ยังไม่มีความจำ — ลองเพิ่มสิ' : 'ไม่มีความจำในหมวดนี้'}
            </Text>
          }
        />
      )}

      <Pressable
        onPress={() => openEditor(null)}
        accessibilityRole="button"
        accessibilityLabel="เพิ่มความจำ"
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-full active:opacity-80"
        style={{ bottom: LAYOUT.actionBar.bottom, backgroundColor: ACCENT, zIndex: 13 }}
      >
        <Plus size={26} color="#ffffff" strokeWidth={2.2} />
      </Pressable>

      <FactEditor
        visible={editorOpen}
        editing={editing}
        onSave={save}
        onCancel={closeEditor}
        onDelete={confirmDelete}
      />
    </View>
  );
}

interface FactRowProps {
  item: ScopedFact;
  onPress: () => void;
  onLongPress: () => void;
}

function FactRow({ item: { fact, target }, onPress, onLongPress }: FactRowProps) {
  const scope = targetLabel(target);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${fact.key}: ${fact.value}`}
      accessibilityHint="แตะเพื่อแก้ไข กดค้างเพื่อลบ"
      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 active:bg-white/10"
    >
      <Text className="text-sm font-bold text-white">{fact.key}</Text>
      <Text className="mt-0.5 text-sm text-white/55" numberOfLines={3}>
        {fact.value}
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-1.5">
        <View className="flex-row items-center gap-1 rounded-full bg-white/10 px-2 py-0.5">
          {scope.color && <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: scope.color }} />}
          <Text className="text-[10px] text-white/70">{scope.label}</Text>
        </View>
        <View className="rounded-full bg-white/10 px-2 py-0.5">
          <Text className="text-[10px] text-white/50">{sourceLabel(fact.source)}</Text>
        </View>
      </View>
    </Pressable>
  );
}
