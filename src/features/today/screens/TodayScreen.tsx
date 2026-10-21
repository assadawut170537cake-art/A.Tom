import { Check, Plus, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PERSONA_IDS } from '../../../core/types/persona';
import { LAYOUT, PERSONAS } from '../../jarvis/constants';
import { useAtomStore } from '../../jarvis/stores/useAtomStore';
import { NOTIFY_PREFIX } from '../../pc-bridge/PcInbox';
import { isToday, MAX_TASK_LENGTH, useTodayStore } from '../todayStore';

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/** เขียนเองไม่ใช้ Intl — Hermes บางรุ่นไม่มีข้อมูลภาษาไทย (ได้วันที่ภาษาอังกฤษ) */
export function thaiDate(d: Date): string {
  return `วัน${DAYS[d.getDay()] ?? ''}ที่ ${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear() + 543}`;
}

const two = (n: number) => String(n).padStart(2, '0');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-4 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
      <Text className="mb-3 text-sm font-semibold text-white/70" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * แท็บ "วันนี้" (Boss ขอ 2026-10-20): เช็กลิสต์งานที่ทำอยู่ · สรุปการคุยของวันนี้ · แจ้งเตือนจาก PC · ผลวิจัยประจำวัน
 * เช็กลิสต์สั่งด้วยแชท/เสียงก็ได้ ("เพิ่มงาน ซื้อของ" · "ติ๊กงาน ซื้อของ" · "งานวันนี้มีอะไร")
 */
export function TodayScreen() {
  const { tasks, loaded, load, add, toggle, remove, clearDone } = useTodayStore();
  const messagesByPersona = useAtomStore((s) => s.messagesByPersona);
  const [draft, setDraft] = useState('');
  const now = new Date();

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const today = new Date();
    const perPersona = PERSONA_IDS.map((p) => ({
      persona: p,
      count: messagesByPersona[p].filter((m) => m.role === 'user' && isToday(m.createdAt, today))
        .length,
    }));
    const notifications = PERSONA_IDS.flatMap((p) => messagesByPersona[p])
      .filter(
        (m) =>
          m.role === 'assistant' &&
          m.content.startsWith(NOTIFY_PREFIX) &&
          isToday(m.createdAt, today),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return { perPersona, total: perPersona.reduce((n, x) => n + x.count, 0), notifications };
  }, [messagesByPersona]);

  const pending = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - pending;

  const submit = () => {
    if (add(draft)) setDraft('');
  };

  return (
    <View className="absolute inset-x-0 bottom-0" style={{ top: LAYOUT.header.height }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: LAYOUT.actionBar.bottom + 72,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold text-white" accessibilityRole="header">
          วันนี้
        </Text>
        <Text className="mb-4 mt-0.5 text-sm text-white/50">{thaiDate(now)}</Text>

        <Section title={`เช็กลิสต์งานที่ทำอยู่ · เหลือ ${pending} งาน`}>
          <View className="mb-3 flex-row items-center gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
              placeholder="เพิ่มงาน…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              maxLength={MAX_TASK_LENGTH}
              returnKeyType="done"
              accessibilityLabel="เพิ่มงานใหม่"
              className="flex-1 rounded-2xl bg-white/10 px-4 py-2.5 text-[15px] text-white"
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="เพิ่มงาน"
              className="h-10 w-10 items-center justify-center rounded-full bg-white/15"
              style={{ opacity: draft.trim() ? 1 : 0.4 }}
            >
              <Plus size={18} color="#fff" />
            </Pressable>
          </View>

          {loaded && tasks.length === 0 && (
            <Text className="py-2 text-sm text-white/45">
              ยังไม่มีงาน — พิมพ์ด้านบน หรือบอกผู้ช่วยว่า “เพิ่มงาน …”
            </Text>
          )}
          {tasks.map((t) => (
            <View key={t.id} className="flex-row items-center gap-3 py-2">
              <Pressable
                onPress={() => toggle(t.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: t.done }}
                accessibilityLabel={t.text}
                hitSlop={6}
                className="h-6 w-6 items-center justify-center rounded-md border"
                style={{
                  borderColor: t.done ? '#22c55e' : 'rgba(255,255,255,0.35)',
                  backgroundColor: t.done ? '#22c55e' : 'transparent',
                }}
              >
                {t.done && <Check size={15} color="#fff" strokeWidth={3} />}
              </Pressable>
              <Text
                className={`flex-1 text-[15px] ${t.done ? 'text-white/40 line-through' : 'text-white/90'}`}
              >
                {t.text}
              </Text>
              <Pressable
                onPress={() => remove(t.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`ลบงาน ${t.text}`}
              >
                <X size={16} color="rgba(255,255,255,0.4)" />
              </Pressable>
            </View>
          ))}
          {doneCount > 0 && (
            <Pressable onPress={clearDone} accessibilityRole="button" className="mt-2 self-start">
              <Text className="text-xs text-white/50">ล้างที่เสร็จแล้ว ({doneCount})</Text>
            </Pressable>
          )}
        </Section>

        <Section title={`คุยวันนี้ · ${summary.total} ข้อความ`}>
          <View className="flex-row gap-2">
            {summary.perPersona.map(({ persona, count }) => (
              <View key={persona} className="flex-1 items-center rounded-2xl bg-white/[0.06] py-3">
                <Text className="text-lg font-semibold" style={{ color: PERSONAS[persona].color }}>
                  {count}
                </Text>
                <Text className="mt-0.5 text-[11px] text-white/55" numberOfLines={1}>
                  {PERSONAS[persona].name}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title={`แจ้งเตือนจาก PC (Mark 55) · ${summary.notifications.length}`}>
          {summary.notifications.length === 0 ? (
            <Text className="text-sm text-white/45">วันนี้ยังไม่มีแจ้งเตือน</Text>
          ) : (
            summary.notifications.slice(0, 10).map((m) => {
              const d = new Date(m.createdAt);
              return (
                <View key={m.id} className="mb-2 flex-row gap-2">
                  <Text className="text-xs text-white/40">{`${two(d.getHours())}:${two(d.getMinutes())}`}</Text>
                  <Text className="flex-1 text-sm text-white/85">
                    {m.content.slice(NOTIFY_PREFIX.length)}
                  </Text>
                </View>
              );
            })
          )}
        </Section>

        <Section title="ผลวิจัยประจำวัน">
          <Text className="text-sm text-white/45">
            ตัววิจัยประจำวัน (Daily Researcher) ยังไม่เปิด — เปิดแล้วสรุปของวันนี้จะขึ้นที่นี่
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}
