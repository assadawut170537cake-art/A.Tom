import { Bell, CalendarDays, Plus, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { LAYOUT, PERSONAS } from '../jarvis/constants';
import { extractWhenWithAI } from './aiWhen';
import { dayRange, deviceCalendar, type CalendarEvent, type CalendarService } from './calendar';
import { reminderStore as defaultStore } from './notifications';
import type { Reminder, ReminderStore } from './reminderStore';
import { formatClock, formatToday, formatWhen, parseThaiWhen, type ParsedWhen } from './thaiTime';

const ACCENT = PERSONAS[1].color;

type CalendarState = { kind: 'loading' } | { kind: 'denied' } | { kind: 'error' } | { kind: 'ready'; events: CalendarEvent[] };

interface TodayScreenProps {
  store?: ReminderStore;
  calendar?: CalendarService;
  /** ทางสำรองเมื่ออ่านเวลาเองไม่ออก (ค่าเริ่มต้น = ถาม AI) */
  extract?: (text: string, now: number) => Promise<ParsedWhen | null>;
}

/**
 * แท็บ Today: วันนี้ · ตั้งเตือนด้วยประโยคเดียว ("กินยา อีก 30 นาที") · รายการเตือน · นัดวันนี้ในปฏิทินเครื่อง
 * ช่องพิมพ์อยู่บนสุดเพราะทั้งหน้าเป็น absolute (คีย์บอร์ดจะไม่บัง — ดู GOTCHAS › Keyboard)
 */
export function TodayScreen({
  store = defaultStore,
  calendar = deviceCalendar,
  extract = extractWhenWithAI,
}: TodayScreenProps) {
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cal, setCal] = useState<CalendarState>({ kind: 'loading' });
  // นาฬิกาของหน้า — ให้การเตือนที่ถึงเวลาย้ายไป "เตือนแล้ว" เองโดยไม่ต้องสลับแท็บ
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    store
      .list()
      .then((list) => {
        if (active) setReminders(list);
      })
      .catch((e: unknown) => console.error('[today] โหลดการเตือนไม่ได้', e));
    const unsubscribe = store.subscribe((list) => setReminders(list));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store]);

  const loadEvents = useCallback(async () => {
    const { start, end } = dayRange(0);
    try {
      setCal({ kind: 'ready', events: await calendar.listEvents(start, end) });
    } catch (e) {
      console.error('[today] อ่านปฏิทินไม่ได้', e);
      setCal({ kind: 'error' });
    }
  }, [calendar]);

  useEffect(() => {
    let active = true;
    // ไม่ถามสิทธิ์เองตอนเปิดแท็บ — ให้บอสกดปุ่มอนุญาตเอง (popup ขึ้นทุกครั้งที่สลับแท็บน่ารำคาญ)
    void calendar.hasPermission().then((granted) => {
      if (!active) return;
      if (granted) void loadEvents();
      else setCal({ kind: 'denied' });
    });
    return () => {
      active = false;
    };
  }, [calendar, loadEvents]);

  const askCalendar = async () => {
    if (await calendar.requestPermission()) await loadEvents();
    else setCal({ kind: 'denied' });
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const now = Date.now();
      const when = parseThaiWhen(text, now) ?? (await extract(text, now));
      if (!when) {
        setError('ยังไม่รู้ว่าจะเตือนเมื่อไร — ลองใส่เวลา เช่น "อีก 30 นาที" หรือ "พรุ่งนี้ 9 โมง"');
        return;
      }
      await store.add(when.text, when.at);
      setDraft('');
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตั้งเตือนไม่สำเร็จ — ลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  };

  const upcoming = reminders.filter((r) => r.at > now);
  const passedToday = reminders.filter((r) => r.at <= now && r.at >= dayRange(0, now).start);

  return (
    <View className="absolute inset-x-0 bottom-0" style={{ top: LAYOUT.header.height }}>
      <View className="px-4 pb-3 pt-2">
        <Text className="text-xl font-semibold text-white" accessibilityRole="header">
          {formatToday(now)}
        </Text>
        <Text className="mt-1 text-xs text-white/45">พิมพ์สิ่งที่ต้องทำพร้อมเวลา แล้วผู้ช่วยจะเตือนให้</Text>
      </View>

      <View className="mx-4 flex-row items-center gap-2 rounded-2xl bg-white/[0.08] py-1 pl-4 pr-1">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void submit()}
          placeholder='เช่น "กินยา อีก 30 นาที"'
          placeholderTextColor="rgba(255,255,255,0.35)"
          returnKeyType="done"
          accessibilityLabel="ตั้งเตือน"
          className="flex-1 py-2.5 text-[15px] text-white"
        />
        <Pressable
          onPress={() => void submit()}
          disabled={!draft.trim() || saving}
          accessibilityRole="button"
          accessibilityLabel="เพิ่มการเตือน"
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: draft.trim() ? ACCENT : 'rgba(255,255,255,0.1)' }}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Plus size={20} color="#ffffff" />}
        </Pressable>
      </View>
      {error && (
        <Text className="mx-4 mt-2 text-xs text-red-300" accessibilityRole="alert">
          {error}
        </Text>
      )}

      <ScrollView
        className="mt-3 flex-1"
        contentContainerClassName="px-4"
        contentContainerStyle={{ paddingBottom: LAYOUT.actionBar.bottom + 72 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionTitle icon="bell" label="เตือนความจำ" count={upcoming.length} />
        {upcoming.length === 0 && passedToday.length === 0 ? (
          <Text className="py-3 text-sm text-white/40">ยังไม่มีการเตือน — ลองพิมพ์ หรือบอกในแชทว่า “เตือนพรุ่งนี้ 9 โมง ประชุม”</Text>
        ) : (
          <View className="gap-2">
            {upcoming.map((r) => (
              <ReminderRow key={r.id} reminder={r} now={now} onRemove={() => void store.remove(r.id)} />
            ))}
            {passedToday.map((r) => (
              <ReminderRow key={r.id} reminder={r} now={now} passed onRemove={() => void store.remove(r.id)} />
            ))}
          </View>
        )}

        <View className="mt-6">
          <SectionTitle icon="calendar" label="นัดวันนี้" count={cal.kind === 'ready' ? cal.events.length : null} />
          {cal.kind === 'loading' && <ActivityIndicator color={ACCENT} className="py-3" />}
          {cal.kind === 'denied' && (
            <Pressable
              onPress={() => void askCalendar()}
              accessibilityRole="button"
              className="mt-1 self-start rounded-full border px-4 py-2"
              style={{ borderColor: ACCENT }}
            >
              <Text className="text-sm text-white">อนุญาตให้ดูปฏิทิน</Text>
            </Pressable>
          )}
          {cal.kind === 'error' && <Text className="py-3 text-sm text-red-300">อ่านปฏิทินไม่ได้ — ลองเปิดแท็บนี้ใหม่</Text>}
          {cal.kind === 'ready' &&
            (cal.events.length === 0 ? (
              <Text className="py-3 text-sm text-white/40">วันนี้ไม่มีนัดในปฏิทิน</Text>
            ) : (
              <View className="gap-2">
                {cal.events.map((e) => (
                  <View key={e.id} className="flex-row gap-3 rounded-xl bg-white/[0.06] px-4 py-3">
                    <Text className="w-14 text-sm font-medium" style={{ color: ACCENT }}>
                      {e.allDay ? 'ทั้งวัน' : formatClock(e.start)}
                    </Text>
                    <View className="flex-1">
                      <Text className="text-[15px] text-white">{e.title}</Text>
                      {e.location && <Text className="mt-0.5 text-xs text-white/45">{e.location}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ icon, label, count }: { icon: 'bell' | 'calendar'; label: string; count: number | null }) {
  const Icon = icon === 'bell' ? Bell : CalendarDays;
  return (
    <View className="mb-2 flex-row items-center gap-2">
      <Icon size={16} color={ACCENT} />
      <Text className="text-sm font-semibold text-white/80">{label}</Text>
      {count !== null && count > 0 && <Text className="text-xs text-white/40">{count}</Text>}
    </View>
  );
}

interface ReminderRowProps {
  reminder: Reminder;
  now: number;
  passed?: boolean;
  onRemove: () => void;
}

function ReminderRow({ reminder, now, passed = false, onRemove }: ReminderRowProps) {
  return (
    <View className={`flex-row items-center rounded-xl bg-white/[0.06] py-2 pl-4 pr-1 ${passed ? 'opacity-45' : ''}`}>
      <View className="flex-1">
        <Text className="text-[15px] text-white">{reminder.text}</Text>
        <Text className="mt-0.5 text-xs text-white/50">
          {passed ? `เตือนแล้ว ${formatClock(reminder.at)} น.` : formatWhen(reminder.at, now)}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`ลบการเตือน ${reminder.text}`}
        hitSlop={8}
        className="h-10 w-10 items-center justify-center"
      >
        <X size={18} color="rgba(255,255,255,0.5)" />
      </Pressable>
    </View>
  );
}
