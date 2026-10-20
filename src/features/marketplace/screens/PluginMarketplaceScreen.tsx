import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { redactSecrets } from '../../../core/http/errors';
import { PERSONAS } from '../../jarvis/constants';
import { SmallButton } from '../../settings/components/ui';
import {
  MARKET_CATEGORIES,
  MARKET_TABS,
  categoryCounts,
  entriesFor,
  type MarketScope,
  type MarketSort,
  type MarketTab,
} from '../marketCatalog';
import {
  DEFAULT_MARKETPLACE_DEPS,
  loadEntries,
  removeEntry,
  setEntryEnabled,
  type MarketEntry,
  type MarketplaceDeps,
} from '../marketplaceModel';
import {
  registryServerId,
  searchMcpRegistry,
  type RegistrySearch,
  type RegistryServer,
} from '../mcpRegistry';

/** ส้มของอะตอม = สีหลักของแอป */
const ACCENT = PERSONAS[1].color;

export const EMPTY_MARKET_TEXT = 'ไม่พบรายการที่ตรงกับการค้นหา';
/** หมวด "ทั้งหมด" ในหน้าสำรวจ (ไม่กรองหมวด) */
const ALL = '*';

const errorText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e));

interface RegistryState {
  query: string;
  items: RegistryServer[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * ตั้งค่า › Modules › Marketplace — จัดแบบหน้า "ปรับแต่ง" ของ Claude (Boss ขอ · ADR-021):
 * แท็บ ทักษะ / ตัวเชื่อมต่อ (MCP) / ปลั๊กอิน · ของคุณ (ติดตั้งแล้ว) / สำรวจ (หมวดหมู่ → รายการ) · ค้นหา · เรียง · + เพิ่ม
 * สำรวจ › ตัวเชื่อมต่อ ดึงคลัง MCP ทางการ (เฉพาะแบบ remote ที่มือถือต่อได้)
 */
export function PluginMarketplaceScreen({
  deps = DEFAULT_MARKETPLACE_DEPS,
  registrySearch = searchMcpRegistry,
}: {
  deps?: MarketplaceDeps;
  registrySearch?: RegistrySearch;
}) {
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<MarketTab>('skill');
  const [scope, setScope] = useState<MarketScope>('mine');
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MarketSort>('name');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [registry, setRegistry] = useState<RegistryState | null>(null);

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
    Alert.alert(
      `ลบ ${entry.title}?`,
      entry.kind === 'mcp' ? 'token ที่บันทึกไว้จะถูกลบด้วย' : 'ติดตั้งใหม่ได้ภายหลัง',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: () => void run(async () => (await removeEntry(deps, entry), null)),
        },
      ],
    );

  const searchRegistry = async (q: string, more = false) => {
    const prev = more ? registry : null;
    setRegistry({
      query: q,
      items: prev?.items ?? [],
      cursor: prev?.cursor ?? null,
      loading: true,
      error: null,
    });
    try {
      const page = await registrySearch(q, prev?.cursor);
      setRegistry({
        query: q,
        items: [...(prev?.items ?? []), ...page.servers],
        cursor: page.nextCursor,
        loading: false,
        error: null,
      });
    } catch (e) {
      console.error('[marketplace] ค้นคลัง MCP ไม่ได้', e);
      setRegistry({
        query: q,
        items: prev?.items ?? [],
        cursor: null,
        loading: false,
        error: 'ค้นคลัง MCP ไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่',
      });
    }
  };

  const addFromRegistry = (server: RegistryServer, token: string) =>
    run(async () => {
      const taken = entries.filter((e) => e.kind === 'mcp').map((e) => e.id);
      const error = await deps.mcp.addServer({
        id: registryServerId(server.name, taken),
        name: server.title,
        url: server.url,
        token,
      });
      return error ?? `เพิ่ม "${server.title}" แล้ว — เปิดสวิตช์ในแท็บ ของคุณ เพื่อเชื่อมต่อ`;
    });

  const switchTab = (t: MarketTab) => {
    setTab(t);
    setCategory(null);
    setRegistry(null);
    setAdding(false);
  };
  const switchScope = (s: MarketScope) => {
    setScope(s);
    setCategory(null);
    setRegistry(null);
  };

  const exploringRegistry = scope === 'explore' && tab === 'connector';
  const visible = useMemo(
    () =>
      entriesFor(entries, tab, scope, query, sort, category && category !== ALL ? category : null),
    [entries, tab, scope, query, sort, category],
  );
  const showTiles =
    scope === 'explore' && !category && !query.trim() && !(exploringRegistry && registry);
  const installedUrls = new Set(entries.filter((e) => e.kind === 'mcp').map((e) => e.subtitle));

  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="gap-3 p-4 pb-16"
      keyboardShouldPersistTaps="handled"
    >
      <Segmented
        items={MARKET_TABS.map((t) => ({ id: t.id, label: t.label }))}
        value={tab}
        onChange={switchTab}
      />
      <Segmented
        items={[
          { id: 'mine', label: 'ของคุณ' },
          { id: 'explore', label: 'สำรวจ' },
        ]}
        value={scope}
        onChange={switchScope}
        small
      />

      <View className="flex-row items-center gap-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => exploringRegistry && void searchRegistry(query)}
          returnKeyType="search"
          placeholder={exploringRegistry ? 'ค้นหาในคลัง MCP…' : 'ค้นหา…'}
          placeholderTextColor="rgba(255,255,255,0.3)"
          accessibilityLabel="ค้นหา"
          autoCorrect={false}
          className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
        />
        <SmallButton
          label={sort === 'name' ? '↑↓ ชื่อ' : '↑↓ เปิดอยู่'}
          accessibilityLabel={`เรียงตาม${sort === 'name' ? 'ชื่อ' : 'ที่เปิดอยู่ก่อน'}`}
          onPress={() => setSort((s) => (s === 'name' ? 'enabled' : 'name'))}
        />
        {tab === 'connector' && (
          <SmallButton
            label="+ เพิ่ม"
            tone="primary"
            disabled={busy}
            onPress={() => setAdding(true)}
          />
        )}
      </View>

      {notice && (
        <Text
          accessibilityRole="alert"
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80"
        >
          {notice}
        </Text>
      )}

      {adding && tab === 'connector' && (
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
      )}

      {showTiles ? (
        <CategoryTiles
          tiles={
            tab === 'connector'
              ? MARKET_CATEGORIES.map((c) => ({
                  id: c.id,
                  label: c.label,
                  icon: c.icon,
                  count: null,
                }))
              : categoryCounts(entriesFor(entries, tab, 'explore', '', sort))
          }
          total={tab === 'connector' ? null : entriesFor(entries, tab, 'explore', '', sort).length}
          onPick={(id) => {
            if (tab === 'connector') {
              const cat = MARKET_CATEGORIES.find((c) => c.id === id);
              void searchRegistry(id === ALL ? '' : (cat?.search ?? ''));
            } else setCategory(id);
          }}
        />
      ) : (
        scope === 'explore' && (
          <Pressable
            onPress={() => {
              setCategory(null);
              setRegistry(null);
              setQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="กลับไปหมวดหมู่"
            className="self-start py-1"
          >
            <Text className="text-xs text-white/60">‹ หมวดหมู่</Text>
          </Pressable>
        )
      )}

      {exploringRegistry && registry && (
        <RegistryList
          state={registry}
          installedUrls={installedUrls}
          busy={busy}
          onAdd={addFromRegistry}
          onMore={() => void searchRegistry(registry.query, true)}
        />
      )}

      {!showTiles && !exploringRegistry && (
        <>
          {loaded && visible.length === 0 && (
            <Text className="py-8 text-center text-sm text-white/50">{EMPTY_MARKET_TEXT}</Text>
          )}
          {visible.map((entry) => (
            <EntryCard
              key={entry.key}
              entry={entry}
              expanded={expanded === entry.key}
              busy={busy}
              onToggleDetail={() => setExpanded((cur) => (cur === entry.key ? null : entry.key))}
              onSetEnabled={(on) => void run(() => setEntryEnabled(deps, entry, on))}
              onInstall={() =>
                void run(
                  async () => (
                    await deps.skills.install(entry.id),
                    `ติดตั้งทักษะ "${entry.title}" แล้ว`
                  ),
                )
              }
              onRemove={() => confirmRemove(entry)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Segmented<T extends string>({
  items,
  value,
  onChange,
  small = false,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  small?: boolean;
}) {
  return (
    <View className={`flex-row gap-1 self-start rounded-2xl bg-white/5 p-1`}>
      {items.map((it) => (
        <Pressable
          key={it.id}
          onPress={() => onChange(it.id)}
          accessibilityRole="tab"
          accessibilityLabel={it.label}
          accessibilityState={{ selected: value === it.id }}
          className={`rounded-xl ${small ? 'px-3 py-1.5' : 'px-4 py-2'} ${value === it.id ? 'bg-white/15' : ''}`}
        >
          <Text
            className={`${small ? 'text-xs' : 'text-sm'} ${value === it.id ? 'text-white' : 'text-white/50'}`}
          >
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function CategoryTiles({
  tiles,
  total,
  onPick,
}: {
  tiles: { id: string; label: string; icon: string; count: number | null }[];
  total: number | null;
  onPick: (id: string) => void;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between px-1">
        <Text className="text-sm font-semibold text-white">หมวดหมู่</Text>
        <Pressable
          onPress={() => onPick(ALL)}
          accessibilityRole="button"
          accessibilityLabel="แสดงทั้งหมด"
        >
          <Text className="text-xs text-white/60">
            {total === null ? 'แสดงทั้งหมด ›' : `แสดงทั้งหมด ${total} รายการ ›`}
          </Text>
        </Pressable>
      </View>
      {tiles.length === 0 && (
        <Text className="py-6 text-center text-sm text-white/50">ยังไม่มีรายการให้สำรวจ</Text>
      )}
      {tiles.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onPick(t.id)}
          accessibilityRole="button"
          accessibilityLabel={`หมวด ${t.label}`}
          className="flex-row items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 active:opacity-70"
        >
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <Text className="text-base text-white">{t.icon}</Text>
          </View>
          <Text className="flex-1 text-[15px] text-white">{t.label}</Text>
          {t.count !== null && <Text className="text-sm text-white/50">{t.count}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

function RegistryList({
  state,
  installedUrls,
  busy,
  onAdd,
  onMore,
}: {
  state: RegistryState;
  installedUrls: ReadonlySet<string>;
  busy: boolean;
  onAdd: (server: RegistryServer, token: string) => void;
  onMore: () => void;
}) {
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState('');
  return (
    <View className="gap-3">
      {state.error && (
        <Text accessibilityRole="alert" className="text-xs text-red-300">
          {state.error}
        </Text>
      )}
      {!state.loading && !state.error && state.items.length === 0 && (
        <Text className="py-8 text-center text-sm text-white/50">{EMPTY_MARKET_TEXT}</Text>
      )}
      {state.items.map((s) => {
        const installed = installedUrls.has(s.url);
        return (
          <View key={s.name} className="gap-2 rounded-2xl border border-white/10 bg-white/5 p-4">
            <View className="flex-row items-center gap-2">
              <Text className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/70">
                MCP
              </Text>
              <Text className="flex-1 text-[15px] font-semibold text-white">{s.title}</Text>
              {installed ? (
                <Text className="text-xs text-white/50">ติดตั้งแล้ว</Text>
              ) : (
                <SmallButton
                  label="เพิ่ม"
                  accessibilityLabel={`เพิ่ม ${s.title}`}
                  disabled={busy}
                  onPress={() => (s.needsToken ? setTokenFor(s.name) : onAdd(s, ''))}
                />
              )}
            </View>
            {!!s.description && <Text className="text-xs text-white/50">{s.description}</Text>}
            {tokenFor === s.name && (
              <View className="gap-2">
                <TextInput
                  value={token}
                  onChangeText={setToken}
                  placeholder="Token / API key ที่ server นี้ต้องใช้"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  accessibilityLabel={`Token ของ ${s.title}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  className="rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
                />
                <View className="flex-row gap-2">
                  <SmallButton
                    label="บันทึก"
                    tone="primary"
                    disabled={busy}
                    onPress={() => {
                      onAdd(s, token);
                      setTokenFor(null);
                      setToken('');
                    }}
                  />
                  <SmallButton label="ยกเลิก" onPress={() => setTokenFor(null)} />
                </View>
              </View>
            )}
          </View>
        );
      })}
      {state.loading && (
        <Text className="py-4 text-center text-xs text-white/50">กำลังโหลดคลัง MCP…</Text>
      )}
      {!state.loading && state.cursor && <SmallButton label="โหลดเพิ่ม" onPress={onMore} />}
    </View>
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

function EntryCard({
  entry: e,
  expanded,
  busy,
  onToggleDetail,
  onSetEnabled,
  onInstall,
  onRemove,
}: EntryCardProps) {
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
            <Text className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/70">
              {e.badge}
            </Text>
            <Text className="flex-1 text-[15px] font-semibold text-white">{e.title}</Text>
          </View>
          <Text className="mt-1 text-xs text-white/50">{e.subtitle}</Text>
          {e.status !== undefined && (
            <Text className="mt-1 text-[11px] text-white/40">{e.status}</Text>
          )}
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
          <SmallButton
            label="ติดตั้ง"
            accessibilityLabel={`ติดตั้ง ${e.title}`}
            disabled={busy}
            onPress={onInstall}
          />
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
              <SmallButton
                label="ลบ"
                tone="danger"
                accessibilityLabel={`ลบ ${e.title}`}
                disabled={busy}
                onPress={onRemove}
              />
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
