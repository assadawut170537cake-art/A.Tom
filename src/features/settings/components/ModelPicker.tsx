import { Check, ChevronDown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { redactSecrets } from '../../../core/http/errors';
import type { AIProvider } from '../../ai/core/types';
import { modelListCache } from '../modelListCache';
import { FieldLabel, SmallButton } from './ui';

type LoadState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string };

interface ModelPickerProps {
  provider: AIProvider;
  value: string;
  /** null = ยังเช็กไม่เสร็จว่ามี key ไหม (ยังไม่โหลด และยังไม่โชว์คำเตือน) */
  hasKey: boolean | null;
  onChange: (model: string) => void;
  label?: string;
}

const INPUT_CLASS = 'rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white';

/** รายการที่ใช้ตอนยังไม่มีรายชื่อจาก API: รายการใน config (ถ้าเป็นแบบ dynamic = ไม่มี) */
const staticModels = (provider: AIProvider): string[] =>
  provider.config.models === 'dynamic' ? [] : [...provider.config.models];

/**
 * เลือกโมเดลจากรายชื่อที่ดึงจาก API ของผู้ให้บริการ (`listModels()`) — มีช่องค้นหา, โหลดใหม่,
 * และ "พิมพ์ชื่อเอง" สำหรับตอนดึงรายชื่อไม่ได้หรือโมเดลยังไม่อยู่ในรายการ
 * รายชื่อที่ดึงแล้ว cache ใน `modelListCache` ตลอด session
 * เจ้าของ key ต้อง remount (เปลี่ยน `key`) เมื่อบันทึก/ลบ API key เพื่อลืมรายชื่อและ error เดิม
 */
export function ModelPicker({
  provider,
  value,
  hasKey,
  onChange,
  label = 'โมเดล',
}: ModelPickerProps) {
  const { id, name } = provider.config;
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<string[] | undefined>(() => modelListCache.get(id));
  const [load, setLoad] = useState<LoadState>({ state: 'idle' });
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(value);
  // กันผลของคำขอเก่าทับคำขอใหม่ (กดโหลดใหม่ซ้ำ / key เปลี่ยนระหว่างโหลด)
  const requestId = useRef(0);
  // โหลดอัตโนมัติแค่ครั้งเดียว — ล้มแล้วไม่วนโหลดเอง (ให้บอสกด "โหลดรายชื่อใหม่")
  // key เปลี่ยน → ProviderCard remount picker (prop `key`) จึงเริ่มนับใหม่เอง
  const autoLoaded = useRef(false);
  const canList = typeof provider.listModels === 'function';

  const fetchModels = useCallback(async () => {
    if (!provider.listModels) return;
    const run = ++requestId.current;
    setLoad({ state: 'loading' });
    try {
      const models = await provider.listModels();
      if (run !== requestId.current) return;
      modelListCache.set(id, models);
      setFetched(models);
      setLoad({ state: 'idle' });
    } catch (e) {
      if (run !== requestId.current) return;
      // ProviderError มีข้อความไทยอยู่แล้ว · redact กันกรณี error แปลก ๆ ที่มี key ติดมา
      const detail = redactSecrets(e instanceof Error ? e.message : String(e));
      setLoad({ state: 'error', message: detail });
    }
  }, [id, provider]);

  // เปิดครั้งแรก (ยังไม่มีใน cache) → โหลดให้เลย ไม่ต้องกดปุ่ม
  useEffect(() => {
    if (!open || !hasKey || !canList || fetched || autoLoaded.current) return;
    autoLoaded.current = true;
    void fetchModels();
  }, [open, hasKey, canList, fetched, fetchModels]);

  const options = useMemo(() => {
    const base = fetched ?? staticModels(provider);
    // โมเดลที่เลือกอยู่ต้องเห็นเสมอ แม้ไม่อยู่ในรายชื่อ (เช่น พิมพ์เองไว้ หรือ API เลิกให้บริการแล้ว)
    const all = value && !base.includes(value) ? [value, ...base] : base;
    const q = query.trim().toLowerCase();
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  }, [fetched, provider, value, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setManual(false);
  };

  const pick = (model: string) => {
    onChange(model);
    close();
  };

  const startManual = () => {
    setDraft(query.trim() || value);
    setManual(true);
  };

  const submitManual = () => {
    const model = draft.trim();
    if (model) pick(model);
  };

  const loading = load.state === 'loading';

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'ยังไม่ได้เลือก'}`}
        accessibilityHint="เปิดรายชื่อโมเดลให้เลือก"
        className="flex-row items-center rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 active:bg-white/10"
      >
        <Text className={`flex-1 text-sm ${value ? 'text-white' : 'text-white/30'}`} numberOfLines={1}>
          {value || 'เลือกโมเดล…'}
        </Text>
        <ChevronDown size={16} color="rgba(255,255,255,0.6)" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable className="flex-1 bg-black/60" onPress={close} accessibilityLabel="ปิด" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            className="max-h-[80%] gap-2 rounded-t-3xl border-t border-white/10 bg-[#11131a] pt-4"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <View className="flex-row items-center gap-2 px-5">
              <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
                {`${label} · ${name}`}
              </Text>
              {canList && (
                <SmallButton
                  label={loading ? 'กำลังโหลด…' : 'โหลดรายชื่อใหม่'}
                  disabled={loading || !hasKey}
                  onPress={() => void fetchModels()}
                />
              )}
            </View>

            {hasKey === false && canList && (
              <Text className="px-5 text-xs leading-5 text-amber-300">
                {`ยังไม่ได้บันทึก API key ของ ${name} — บันทึก key ในการ์ดก่อนเพื่อโหลดรายชื่อโมเดล หรือกด "พิมพ์ชื่อเอง"`}
              </Text>
            )}
            {loading && (
              <View className="flex-row items-center gap-2 px-5">
                <ActivityIndicator size="small" color="#fff" />
                <Text className="text-xs text-white/60">กำลังโหลดรายชื่อโมเดล…</Text>
              </View>
            )}
            {load.state === 'error' && (
              <Text className="px-5 text-xs leading-5 text-red-300" accessibilityLiveRegion="polite">
                {`โหลดรายชื่อโมเดลไม่ได้ — ${load.message}\nกด "โหลดรายชื่อใหม่" เพื่อลองอีกครั้ง หรือ "พิมพ์ชื่อเอง"`}
              </Text>
            )}

            {manual ? (
              <View className="flex-row items-center gap-2 px-5">
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="เช่น gemini-3-flash"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  accessibilityLabel="ชื่อโมเดล"
                  onSubmitEditing={submitManual}
                  className={`flex-1 ${INPUT_CLASS}`}
                />
                <SmallButton label="ใช้ชื่อนี้" tone="primary" disabled={!draft.trim()} onPress={submitManual} />
                <SmallButton label="ยกเลิก" onPress={() => setManual(false)} />
              </View>
            ) : (
              <View className="flex-row items-center gap-2 px-5">
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="ค้นหาโมเดล"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="ค้นหาโมเดล"
                  className={`flex-1 ${INPUT_CLASS}`}
                />
                <SmallButton label="พิมพ์ชื่อเอง" onPress={startManual} />
              </View>
            )}

            <Text className="px-5 text-[11px] text-white/40">
              {fetched
                ? `รายชื่อจาก ${name} · ${fetched.length} โมเดล`
                : 'รายการเริ่มต้นของแอป (ยังไม่ได้โหลดจาก API)'}
            </Text>

            <FlatList
              data={options}
              keyExtractor={(m) => m}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text className="px-5 py-6 text-center text-sm text-white/40">
                  {query.trim() ? `ไม่พบโมเดลที่มีคำว่า "${query.trim()}"` : 'ยังไม่มีรายชื่อโมเดล'}
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item === value;
                return (
                  <Pressable
                    onPress={() => pick(item)}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected }}
                    className={`flex-row items-center px-5 py-3 active:bg-white/10 ${selected ? 'bg-white/5' : ''}`}
                  >
                    <Text className="flex-1 text-[15px] text-white">{item}</Text>
                    {selected && <Check size={16} color="#38bdf8" />}
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
