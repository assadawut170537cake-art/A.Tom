import { Check, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldLabel, SmallButton } from './ui';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string | undefined;
}

interface ModelSelectorProps<T extends string> {
  label: string;
  value?: T | undefined;
  options: SelectOption<T>[];
  /** Receives the option's own value type (e.g. TTSProviderId), so callers need no casts. */
  onChange: (value: T) => void;
  placeholder?: string;
  /** Optional live refresh (e.g. provider.getModels()); errors are shown inline. */
  onRefresh?: () => Promise<void>;
}

/** Dropdown-style picker in a bottom sheet modal. Used for models, providers and voices. */
export function ModelSelector<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'เลือก…',
  onRefresh,
}: ModelSelectorProps<T>) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = options.find((o) => o.value === value);

  const refresh = async () => {
    if (!onRefresh) return;
    setLoading(true);
    setError(null);
    try {
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? value ?? placeholder}`}
        className="flex-row items-center rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 active:bg-white/10"
      >
        <Text
          className={`flex-1 text-sm ${value ? 'text-white' : 'text-white/30'}`}
          numberOfLines={1}
        >
          {current?.label ?? value ?? placeholder}
        </Text>
        <ChevronDown size={16} color="rgba(255,255,255,0.6)" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1 bg-black/60"
          onPress={() => setOpen(false)}
          accessibilityLabel="ปิด"
        />
        <View
          className="max-h-[70%] rounded-t-3xl border-t border-white/10 bg-[#11131a]"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="flex-row items-center gap-2 px-5 pb-2 pt-4">
            <Text className="flex-1 text-base font-semibold text-white">{label}</Text>
            {onRefresh && (
              <SmallButton
                label={loading ? 'กำลังโหลด…' : 'โหลดรายการ'}
                disabled={loading}
                onPress={refresh}
              />
            )}
          </View>
          {loading && <ActivityIndicator color="#fff" className="py-2" />}
          {error && <Text className="px-5 pb-2 text-xs text-red-300">{error}</Text>}
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            ListEmptyComponent={
              <Text className="px-5 py-6 text-center text-sm text-white/40">ไม่มีรายการ</Text>
            }
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  className={`flex-row items-center px-5 py-3 active:bg-white/10 ${selected ? 'bg-white/5' : ''}`}
                >
                  <View className="flex-1">
                    <Text className="text-[15px] text-white">{item.label}</Text>
                    {item.hint && <Text className="mt-0.5 text-xs text-white/40">{item.hint}</Text>}
                  </View>
                  {selected && <Check size={16} color="#38bdf8" />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}
