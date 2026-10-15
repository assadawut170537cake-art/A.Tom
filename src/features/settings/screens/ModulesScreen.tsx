import { Puzzle } from 'lucide-react-native';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { redactSecrets } from '../../../core/http/errors';
import { moduleManager, type ModuleManager, type ModuleView } from '../../../core/modules/ModuleManager';
import type { ModuleStatus } from '../../../core/modules/types';
import { PERSONAS } from '../../jarvis/constants';
import { SmallButton } from '../components/ui';

/** ส้มของอะตอม = สีหลักของแอป (เหมือนหน้า Memory) */
const ACCENT = PERSONAS[1].color;

export const EMPTY_MODULES_TEXT = 'ยังไม่มี Module — รอ Phase 4.5.5';

const STATUS: Record<ModuleStatus, { label: string; color: string }> = {
  enabled: { label: 'ทำงานอยู่', color: '#34d399' },
  'not-initialized': { label: 'ยังไม่เริ่ม', color: '#fbbf24' },
  error: { label: 'เริ่มไม่สำเร็จ', color: '#f87171' },
  disabled: { label: 'ปิดอยู่', color: 'rgba(255,255,255,0.45)' },
};

interface Notice {
  tone: 'info' | 'error';
  text: string;
}

const SAVE_FAILED: Notice = {
  tone: 'error',
  text: 'บันทึกค่าลงเครื่องไม่สำเร็จ — ตอนนี้ใช้ได้ตามที่ตั้ง แต่เปิดแอปใหม่จะกลับเป็นค่าเดิม',
};

const errorText = (e: unknown) => redactSecrets(e instanceof Error ? e.message : String(e));

/** ตั้งค่า › Modules: ดูสถานะ เปิด/ปิด และเริ่ม module ใหม่ — ค่าเปิด/ปิดจำไว้ข้ามการเปิดแอป (ModuleManager) */
export function ModulesScreen({ manager = moduleManager }: { manager?: ModuleManager }) {
  const modules = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const nameOf = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  const names = (ids: readonly string[]) => ids.map(nameOf).join(', ');

  /** ทำทีละรายการ (ปุ่ม/สวิตช์ทั้งหมดถูกปิดระหว่างทำ) แล้วแสดงผลเป็น notice */
  const run = async (action: () => Promise<(Notice | null)[]>) => {
    setBusy(true);
    setNotices([]);
    try {
      setNotices((await action()).filter((n): n is Notice => n !== null));
    } catch (e) {
      console.error('[settings] จัดการ module ไม่สำเร็จ', e);
      setNotices([{ tone: 'error', text: 'ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง' }]);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = (m: ModuleView) =>
    run(async () => {
      const { changed, saved } = await manager.enable(m.id);
      const auto = changed.filter((id) => id !== m.id);
      return [
        auto.length > 0 ? { tone: 'info', text: `เปิด ${names(auto)} ให้ด้วย เพราะ ${m.name} ต้องใช้` } : null,
        saved ? null : SAVE_FAILED,
      ];
    });

  const turnOff = (m: ModuleView) => {
    const disable = () =>
      run(async () => {
        const { changed, saved } = await manager.disable(m.id);
        const auto = changed.filter((id) => id !== m.id);
        return [
          auto.length > 0 ? { tone: 'info', text: `ปิด ${names(auto)} ไปด้วย เพราะต้องใช้ ${m.name}` } : null,
          saved ? null : SAVE_FAILED,
        ];
      });
    const dependents = manager.dependentsToDisable(m.id);
    if (dependents.length === 0) {
      void disable();
      return;
    }
    Alert.alert(
      `ปิด ${m.name}?`,
      `module ต่อไปนี้ต้องใช้ ${m.name} และจะถูกปิดไปด้วย:\n${dependents.map((id) => `• ${nameOf(id)}`).join('\n')}`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ปิดทั้งหมด', style: 'destructive', onPress: () => void disable() },
      ]
    );
  };

  const restart = (m: ModuleView) =>
    run(async () => {
      try {
        await manager.reinitialize(m.id);
        return [{ tone: 'info', text: `เริ่ม ${m.name} ใหม่แล้ว` }];
      } catch (e) {
        return [{ tone: 'error', text: `${m.name} ยังเริ่มไม่สำเร็จ: ${errorText(e)}` }];
      }
    });

  const setEnabled = (m: ModuleView, on: boolean) => void (on ? turnOn(m) : turnOff(m));

  return (
    <ScrollView className="flex-1 bg-[#05060a]" contentContainerClassName="gap-3 p-4 pb-16">
      <Text className="px-1 text-xs leading-5 text-white/50">
        ความสามารถเสริมที่เสียบเพิ่มให้ A.T.O.M. — เปิด/ปิดได้ที่นี่ และแอปจะจำค่าไว้แม้ปิดแอป · แตะชื่อเพื่อดูรายละเอียด
      </Text>

      {notices.map((n) => (
        <Text
          key={n.text}
          accessibilityRole={n.tone === 'error' ? 'alert' : 'text'}
          className={`rounded-xl border px-3 py-2 text-xs ${
            n.tone === 'error' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/5 text-white/80'
          }`}
        >
          {n.text}
        </Text>
      ))}

      {modules.length === 0 ? (
        <View className="items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-10">
          <Puzzle size={28} color="rgba(255,255,255,0.4)" />
          <Text className="text-sm font-medium text-white/80">{EMPTY_MODULES_TEXT}</Text>
          <Text className="text-center text-xs text-white/40">module แรกที่วางแผนไว้: PC Bridge (สั่งงานคอมพิวเตอร์)</Text>
        </View>
      ) : (
        modules.map((m) => (
          <ModuleRow
            key={m.id}
            module={m}
            expanded={expanded === m.id}
            busy={busy}
            nameOf={nameOf}
            statusOf={(id) => modules.find((x) => x.id === id)?.status}
            onToggleDetail={() => setExpanded((cur) => (cur === m.id ? null : m.id))}
            onSetEnabled={(on) => setEnabled(m, on)}
            onRestart={() => void restart(m)}
          />
        ))
      )}
    </ScrollView>
  );
}

interface ModuleRowProps {
  module: ModuleView;
  expanded: boolean;
  busy: boolean;
  nameOf: (id: string) => string;
  /** undefined = ไม่ได้ติดตั้ง */
  statusOf: (id: string) => ModuleStatus | undefined;
  onToggleDetail: () => void;
  onSetEnabled: (on: boolean) => void;
  onRestart: () => void;
}

function ModuleRow({ module: m, expanded, busy, nameOf, statusOf, onToggleDetail, onSetEnabled, onRestart }: ModuleRowProps) {
  const depText = (id: string) => {
    const status = statusOf(id);
    return `${nameOf(id)} · ${status ? STATUS[status].label : 'ไม่ได้ติดตั้ง'}`;
  };
  return (
    <View className="rounded-2xl border border-white/10 bg-white/5">
      <View className="flex-row items-center gap-3 pr-4">
        {/* สวิตช์อยู่นอก Pressable — ไม่งั้น screen reader จะรวมเป็นปุ่มเดียวแล้วกดสวิตช์ไม่ได้ */}
        <Pressable
          onPress={onToggleDetail}
          accessibilityRole="button"
          accessibilityLabel={m.name}
          accessibilityHint="แตะเพื่อดูรายละเอียด"
          accessibilityState={{ expanded }}
          className="flex-1 p-4 active:opacity-70"
        >
          <Text className="text-[15px] font-semibold text-white">{m.name}</Text>
          {m.description && <Text className="mt-0.5 text-xs text-white/50">{m.description}</Text>}
          <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
            <StatusBadge status={m.status} initializing={m.state === 'initializing'} />
            {m.dependencies.length > 0 && (
              <Text className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/60">
                ต้องใช้: {m.dependencies.map(nameOf).join(', ')}
              </Text>
            )}
          </View>
        </Pressable>
        <Switch
          value={m.enabled}
          onValueChange={onSetEnabled}
          disabled={busy}
          accessibilityLabel={`เปิดใช้ ${m.name}`}
          trackColor={{ false: 'rgba(255,255,255,0.15)', true: ACCENT }}
          thumbColor="#fff"
        />
      </View>

      {m.status === 'error' && m.error !== undefined && (
        <Text className="-mt-1 px-4 pb-3 text-xs text-red-300" accessibilityRole="alert">
          {redactSecrets(m.error)}
        </Text>
      )}

      {expanded && (
        <View className="gap-2 border-t border-white/10 p-4">
          <DetailLine label="รหัส" value={m.id} />
          <DetailLine label="สถานะ" value={STATUS[m.status].label} />
          <DetailLine label="ต้องใช้" value={m.dependencies.length > 0 ? m.dependencies.map(depText).join('\n') : '—'} />
          <DetailLine label="ใช้โดย" value={m.usedBy.length > 0 ? m.usedBy.map(nameOf).join(', ') : '—'} />
          <View className="mt-2 flex-row gap-2">
            <SmallButton
              label={m.enabled ? 'ปิด module' : 'เปิด module'}
              tone={m.enabled ? 'danger' : 'default'}
              disabled={busy}
              onPress={() => onSetEnabled(!m.enabled)}
            />
            {m.enabled && <SmallButton label="เริ่มใหม่" disabled={busy} onPress={onRestart} />}
          </View>
        </View>
      )}
    </View>
  );
}

function StatusBadge({ status, initializing }: { status: ModuleStatus; initializing: boolean }) {
  const { label, color } = STATUS[status];
  return (
    <View className="flex-row items-center gap-1 rounded-full border border-white/10 px-2 py-0.5">
      <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-[11px]" style={{ color }}>
        {initializing ? 'กำลังเริ่ม…' : label}
      </Text>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-14 text-xs text-white/40">{label}</Text>
      <Text className="flex-1 text-xs text-white/80">{value}</Text>
    </View>
  );
}
