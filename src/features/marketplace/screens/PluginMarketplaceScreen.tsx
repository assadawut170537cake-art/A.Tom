import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { redactSecrets } from '../../../core/http/errors';
import { PERSONAS } from '../../jarvis/constants';
import { SmallButton } from '../../settings/components/ui';
import {
  DEFAULT_MARKETPLACE_DEPS,
  MARKET_FILTERS,
  filterEntries,
  loadEntries,
  removeEntry,
  setEntryEnabled,
  type MarketEntry,
  type MarketFilter,
  type MarketplaceDeps,
} from '../marketplaceModel';

/** ส้มของอะตอม = สีหลักของแอป */
const ACCENT = PERSONAS[1].color;

export const EMPTY_MARKET_TEXT = 'ไม่พบรายการที่ตรงกับการค้นหา';

const errorText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e));

/** ตั้งค่า › Marketplace: MCP servers · Plugins · Skills (ติดตั้ง / AI สร้าง / แนะนำ) · Device Control */
export function PluginMarketplaceScreen({ deps = DEFAULT_MARKETPLACE_DEPS }: { deps?: MarketplaceDeps }) {
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MarketFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      setEntries(await loadEntries(deps));
    } catch (e) {
      console.error('[marketplace] โหลดรายการไม่ได้', e);
      setNotice('โหลดรายการไม่ได้ — ลองปิดแล้วเปิดหน้านี้ใหม่');
    } finally {
      setLoaded(true);
    }
  }, [deps]);

  useEffect(() => {
    // โหลดทันที แล้วเชื่อมต่อ MCP server ที่เปิดอยู่ในเบื้องหลัง (ได้รายการ tool ล่าสุด) แล้วโหลดซ้ำ
    let active = true;
    const apply = (list: MarketEntry[]) => {
      if (!active) return;
      setEntries(list);
      setLoaded(true);
    };
    const fail = (e: unknown) => {
      console.error('[marketplace] โหลดรายการไม่ได้', e);
      if (!active) return;
      setNotice('โหลดรายการไม่ได้ — ลองปิดแล้วเปิดหน้านี้ใหม่');
      setLoaded(true);
    };
    loadEntries(deps)
      .then(apply)
      .then(() => deps.mcp.connectAll())
      .then(() => loadEntries(deps))
      .then(apply)
      .catch(fail);
    return () => {
      active = false;
    };
  }, [deps]);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (e) {
      console.error('[marketplace] ทำรายการไม่สำเร็จ', e);
      setNotice(`ทำรายการไม่สำเร็จ: ${errorText(e)}`);
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const confirmRemove = (entry: MarketEntry) =>
    Alert.alert(`ลบ ${entry.title}?`, entry.kind === 'mcp' ? 'token ที่บันทึกไว้จะถูกลบด้วย' : 'ติดตั้งใหม่ได้ภายหลัง', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบ', style: 'destructive', onPress: () => void run(async () => (await removeEntry(deps, entry), null)) },
    ]);

  const visible = useMemo(() => filterEntries(entries, filter, query), [entries, filter, query]);
  const countOf = (f: MarketFilter) => filterEntries(entries, f, '').length;

  return (
    <ScrollView className="flex-1 bg-[#05060a]" contentContainerClassName="gap-3 p-4 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="px-1 text-xs leading-5 text-white/50">
        แหล่งรวมความสามารถของผู้ช่วย: MCP server ภายนอก · Plugins · ทักษะ (รวมที่ AI สร้างเอง) · การควบคุมอุปกรณ์ — แตะรายการเพื่อดู tools/คำสั่ง
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="ค้นหา MCP, plugin, ทักษะ…"
        placeholderTextColor="rgba(255,255,255,0.3)"
        accessibilityLabel="ค้นหา"
        autoCorrect={false}
        className="rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {MARKET_FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            accessibilityRole="tab"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: filter === f.id }}
            className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
            style={{ borderColor: filter === f.id ? ACCENT : 'rgba(255,255,255,0.15)' }}
          >
            <Text className="text-xs text-white">{f.label}</Text>
            <Text className="text-[11px] text-white/50">{countOf(f.id)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {notice && (
        <Text accessibilityRole="alert" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
          {notice}
        </Text>
      )}

      {(filter === 'all' || filter === 'mcp') &&
        (adding ? (
          <AddServerForm
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              const error = await deps.mcp.addServer(input);
              if (!error) {
                setAdding(false);
                setNotice(`เพิ่ม "${input.name || input.id}" แล้ว — เปิดสวิตช์เพื่อเชื่อมต่อ`);
                await reload();
              }
              return error;
            }}
          />
        ) : (
          <SmallButton label="+ เพิ่ม MCP server" onPress={() => setAdding(true)} disabled={busy} />
        ))}

      {loaded && visible.length === 0 && <Text className="py-8 text-center text-sm text-white/50">{EMPTY_MARKET_TEXT}</Text>}

      {visible.map((entry) => (
        <EntryCard
          key={entry.key}
          entry={entry}
          expanded={expanded === entry.key}
          busy={busy}
          onToggleDetail={() => setExpanded((cur) => (cur === entry.key ? null : entry.key))}
          onSetEnabled={(on) => void run(() => setEntryEnabled(deps, entry, on))}
          onInstall={() =>
            void run(async () => (await deps.skills.install(entry.id), `ติดตั้งทักษะ "${entry.title}" แล้ว`))
          }
          onRemove={() => confirmRemove(entry)}
        />
      ))}
    </ScrollView>
  );
}

interface EntryCardProps {
  entry: MarketEntry;
  expanded: boolean;
  busy: boolean;
  onToggleDetail: () => void;
  onSetEnabled: (on: boolean) => void;
  onInstall: () => void;
  onRemove: () => void;
}

function EntryCard({ entry: e, expanded, busy, onToggleDetail, onSetEnabled, onInstall, onRemove }: EntryCardProps) {
  return (
    <View className="rounded-2xl border border-white/10 bg-white/5">
      <View className="flex-row items-center gap-3 pr-4">
        <Pressable
          onPress={onToggleDetail}
          accessibilityRole="button"
          accessibilityLabel={e.title}
          accessibilityHint="แตะเพื่อดูรายละเอียด"
          accessibilityState={{ expanded }}
          className="flex-1 p-4 active:opacity-70"
        >
          <View className="flex-row items-center gap-2">
            <Text className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/70">{e.badge}</Text>
            <Text className="flex-1 text-[15px] font-semibold text-white">{e.title}</Text>
          </View>
          <Text className="mt-1 text-xs text-white/50">{e.subtitle}</Text>
          {e.status !== undefined && <Text className="mt-1 text-[11px] text-white/40">{e.status}</Text>}
        </Pressable>
        {e.installed ? (
          <Switch
            value={e.enabled}
            onValueChange={onSetEnabled}
            disabled={busy}
            accessibilityLabel={`เปิดใช้ ${e.title}`}
            trackColor={{ false: 'rgba(255,255,255,0.15)', true: ACCENT }}
            thumbColor="#fff"
          />
        ) : (
          <SmallButton label="ติดตั้ง" accessibilityLabel={`ติดตั้ง ${e.title}`} disabled={busy} onPress={onInstall} />
        )}
      </View>
      {expanded && (
        <View className="gap-1.5 border-t border-white/10 p-4">
          {e.details.length ? (
            e.details.map((d) => (
              <Text key={d} className="text-xs text-white/80">
                {d}
              </Text>
            ))
          ) : (
            <Text className="text-xs text-white/40">ยังไม่มีรายละเอียด</Text>
          )}
          {e.removable && (
            <View className="mt-2 flex-row">
              <SmallButton label="ลบ" tone="danger" accessibilityLabel={`ลบ ${e.title}`} disabled={busy} onPress={onRemove} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

interface AddServerInput {
  id: string;
  name: string;
  url: string;
  token: string;
}

function AddServerForm({
  onSave,
  onCancel,
}: {
  onSave: (input: AddServerInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AddServerInput>({ id: '', name: '', url: '', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = (key: keyof AddServerInput, label: string, placeholder: string, secure = false) => (
    <TextInput
      value={form[key]}
      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.3)"
      accessibilityLabel={label}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secure}
      className="rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
    />
  );
  return (
    <View className="gap-2 rounded-2xl border border-white/10 bg-white/5 p-4">
      <Text className="text-sm font-semibold text-white">เพิ่ม MCP server</Text>
      {field('id', 'รหัส server', 'เช่น github')}
      {field('name', 'ชื่อที่แสดง', 'เช่น GitHub')}
      {field('url', 'URL ของ server', 'https://…/mcp')}
      {field('token', 'Token (ถ้ามี)', 'เก็บใน SecureStore', true)}
      {error && (
        <Text accessibilityRole="alert" className="text-xs text-red-300">
          {error}
        </Text>
      )}
      <View className="mt-1 flex-row gap-2">
        <SmallButton label="ยกเลิก" onPress={onCancel} />
        <SmallButton
          label="บันทึก server"
          tone="primary"
          disabled={saving}
          onPress={async () => {
            setSaving(true);
            setError(await onSave(form));
            setSaving(false);
          }}
        />
      </View>
    </View>
  );
}
