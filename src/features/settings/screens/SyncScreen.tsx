import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { memorySync, type MemorySync } from '../../../core/memory/MemorySync';
import { syncErrorText } from '../../../core/memory/RemoteMemoryAdapter';
import { secretSync } from '../../../core/memory/SecretSync';
import { SUPERMEMORY_KEY_NAME } from '../../../core/memory/SuperMemorySync';
import type { ConflictLogEntry, SyncState } from '../../../core/memory/SyncQueue';
import { PERSONAS } from '../../jarvis/constants';
import { targetLabel } from '../../memory/factModel';
import { ApiKeyInput } from '../components/ApiKeyInput';
import { Card, FieldLabel, Section, SmallButton } from '../components/ui';

const ACCENT = PERSONAS[1].color;

export type ConnectionStatus = 'connected' | 'unpaired' | 'offline';

export const STATUS_TEXT: Record<ConnectionStatus, { icon: string; label: string }> = {
  connected: { icon: '🟢', label: 'เชื่อมต่อแล้ว' },
  unpaired: { icon: '🟡', label: 'ยังไม่จับคู่' },
  offline: { icon: '🔴', label: 'เชื่อมต่อไม่ได้' },
};

/** สถานะล่าสุดจากสัญญาณที่ใหม่สุด: ผลทดสอบการเชื่อมต่อ หรือผลซิงก์รอบล่าสุด */
export function connectionStatus(
  queue: SyncState,
  lastCheck: { ok: boolean; at: number } | null,
): ConnectionStatus {
  if (!queue.paired) return 'unpaired';
  const error = queue.lastError;
  if (error && (!lastCheck || error.at >= lastCheck.at)) return 'offline';
  if (lastCheck && !lastCheck.ok) return 'offline';
  return 'connected';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** วัน/เดือน/ปี ชั่วโมง:นาที (ไม่ใช้ toLocaleString — Intl ของ Hermes บางรุ่นไม่มีภาษาไทย) */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Notice {
  tone: 'info' | 'error';
  text: string;
}

/** ตั้งค่า › Sync: เชื่อมต่อ Mark 55 · จับคู่ · ซิงก์ Shared Memory · ดู conflict */
export function SyncScreen({ sync = memorySync }: { sync?: MemorySync }) {
  const conn = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const queue = useSyncExternalStore(sync.queue.subscribe, sync.queue.getSnapshot);
  const [urlDraft, setUrlDraft] = useState(conn.serverUrl);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'test' | 'pair' | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    void sync.start();
  }, [sync]);

  // URL ที่บันทึกไว้โหลดมาถึงทีหลัง render แรก (หรือถูกจัดรูปตอนบันทึก) → ใช้แทนค่าในช่อง
  const [shownUrl, setShownUrl] = useState(conn.serverUrl);

  const pullSecrets = async () => {
    setImporting(true);
    try {
      const result = await secretSync.importOnce(true); // ทับของเดิม — บอสตั้งใจดึงมาใช้
      if (result.reason === 'no_supermemory_key') {
        setNotice({ tone: 'error', text: 'ใส่ Supermemory API key ด้านล่างก่อน แล้วค่อยกดดึง' });
      } else if (result.reason === 'error') {
        setNotice({
          tone: 'error',
          text: 'ดึงคีย์ไม่สำเร็จ — เช็กอินเทอร์เน็ตและ API key ของ Supermemory',
        });
      } else {
        setNotice({ tone: 'info', text: `ดึงคีย์มาใส่เครื่องแล้ว ${result.imported} รายการ` });
      }
    } finally {
      setImporting(false);
    }
  };
  if (shownUrl !== conn.serverUrl) {
    setShownUrl(conn.serverUrl);
    setUrlDraft(conn.serverUrl);
  }

  const status = connectionStatus(queue, conn.lastCheck);
  const paired = queue.paired;

  /** บันทึก URL ที่พิมพ์ (ถ้าเปลี่ยน) — false = URL ใช้ไม่ได้ (แสดง error แล้ว) */
  const commitUrl = async (): Promise<boolean> => {
    if (paired || urlDraft.trim() === conn.serverUrl) return true;
    const error = await sync.setServerUrl(urlDraft);
    if (error) {
      setNotice({ tone: 'error', text: error });
      return false;
    }
    return true;
  };

  const test = async () => {
    setBusy('test');
    setNotice(null);
    try {
      if (!(await commitUrl())) return;
      const check = await sync.testConnection();
      setNotice({ tone: check.ok ? 'info' : 'error', text: check.message });
    } finally {
      setBusy(null);
    }
  };

  const pair = async () => {
    setBusy('pair');
    setNotice(null);
    try {
      if (!(await commitUrl())) return;
      const device = await sync.pair(code);
      setCode('');
      setNotice({
        tone: 'info',
        text: `จับคู่สำเร็จ — ${device.deviceName} · กำลังส่งความจำขึ้น Mark 55`,
      });
    } catch (e) {
      setNotice({ tone: 'error', text: syncErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const unpair = () =>
    Alert.alert(
      'ยกเลิกการจับคู่?',
      'เครื่องนี้จะหยุดซิงก์กับ Mark 55 — ความจำในเครื่องยังอยู่ครบ',
      [
        { text: 'ไม่ใช่', style: 'cancel' },
        {
          text: 'ยกเลิก Pair',
          style: 'destructive',
          onPress: () => {
            void sync.unpair().then(() => setNotice({ tone: 'info', text: 'ยกเลิกการจับคู่แล้ว' }));
          },
        },
      ],
    );

  const syncNow = async () => {
    setNotice(null);
    const res = await sync.queue.flush();
    if (res.ok) {
      setNotice({
        tone: 'info',
        text: `ซิงก์แล้ว — ส่ง ${res.pushed} · รับ ${res.pulled}${res.conflicts > 0 ? ` · ขัดแย้ง ${res.conflicts}` : ''}`,
      });
    } else if (res.error) {
      setNotice({ tone: 'error', text: res.error });
    }
  };

  const codeValid = /^\d{6}$/.test(code);

  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="p-4 pb-16"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-5 px-1 text-xs leading-5 text-white/50">
        ซิงก์ Shared Memory กับ Mark 55 บน PC — ไม่จับคู่ก็ใช้งานได้ตามปกติ
        (เก็บในเครื่องอย่างเดียว)
      </Text>

      {notice && (
        <Text
          accessibilityRole={notice.tone === 'error' ? 'alert' : 'text'}
          className={`mb-5 rounded-xl border px-3 py-2 text-xs ${
            notice.tone === 'error'
              ? 'border-red-400/30 bg-red-500/10 text-red-200'
              : 'border-white/10 bg-white/5 text-white/80'
          }`}
        >
          {notice.text}
        </Text>
      )}

      <Section title="เชื่อมต่อ Server">
        <Card>
          <View
            className="flex-row items-center gap-2"
            accessibilityLabel={`สถานะ: ${STATUS_TEXT[status].label}`}
          >
            <Text>{STATUS_TEXT[status].icon}</Text>
            <Text className="text-sm font-semibold text-white">{STATUS_TEXT[status].label}</Text>
          </View>
          {status === 'offline' && queue.lastError && (
            <Text className="text-xs text-red-300">{queue.lastError.message}</Text>
          )}
          <View>
            <FieldLabel>Server URL</FieldLabel>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              onEndEditing={() => void commitUrl()}
              editable={!paired}
              placeholder="http://192.168.1.10:8787"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Server URL"
              className={`rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white ${paired ? 'opacity-50' : ''}`}
            />
            {paired && (
              <Text className="mt-1 text-[11px] text-white/40">
                ยกเลิกการจับคู่ก่อนถึงจะเปลี่ยน URL ได้
              </Text>
            )}
          </View>
          <View className="flex-row">
            <SmallButton
              label={busy === 'test' ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
              disabled={busy !== null}
              onPress={() => void test()}
            />
          </View>
        </Card>
      </Section>

      <Section
        title="จับคู่อุปกรณ์"
        hint={paired ? undefined : 'ขอรหัส 6 หลักจาก Mark 55 แล้วใส่ที่นี่'}
      >
        <Card>
          {paired ? (
            <>
              <Detail label="ชื่อเครื่อง" value={conn.device?.deviceName ?? '—'} />
              <Detail
                label="หมดอายุ"
                value={conn.device ? formatTime(conn.device.expiresAt) : '—'}
              />
              <View className="flex-row">
                <SmallButton label="ยกเลิก Pair" tone="danger" onPress={unpair} />
              </View>
            </>
          ) : (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="number-pad"
                maxLength={6}
                accessibilityLabel="Pairing Code"
                onSubmitEditing={() => codeValid && void pair()}
                className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-center text-base tracking-[6px] text-white"
              />
              <SmallButton
                label={busy === 'pair' ? 'กำลังจับคู่…' : 'Pair'}
                tone="primary"
                disabled={!codeValid || busy !== null}
                onPress={() => void pair()}
              />
            </View>
          )}
        </Card>
      </Section>

      {paired && (
        <Section title="สถานะการซิงก์">
          <Card>
            <Detail
              label="ซิงก์ล่าสุด"
              value={queue.lastSyncAt > 0 ? formatTime(queue.lastSyncAt) : 'ยังไม่เคย'}
            />
            <Detail label="รอส่ง" value={`${queue.queue.length} รายการ`} />
            <View className="flex-row">
              <SmallButton
                label={queue.currentlySyncing ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}
                tone="primary"
                disabled={queue.currentlySyncing}
                onPress={() => void syncNow()}
              />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-white">
                ซิงก์อัตโนมัติ ({Math.round(queue.autoSyncIntervalMs / 1000)}s)
              </Text>
              <Switch
                value={queue.autoSyncEnabled}
                onValueChange={(on) => void sync.queue.setAutoSync(on)}
                accessibilityLabel="ซิงก์อัตโนมัติ"
                trackColor={{ false: 'rgba(255,255,255,0.15)', true: ACCENT }}
                thumbColor="#fff"
              />
            </View>
          </Card>
        </Section>
      )}

      {queue.conflicts.length > 0 && (
        <Section
          title="ประวัติ Conflict"
          hint="key ที่แก้ทั้งในเครื่องนี้และที่อื่น — ใช้ฉบับที่ใหม่กว่า (การแก้ชนะการลบ)"
        >
          {queue.conflicts.map((c) => (
            <ConflictRow key={c.id} conflict={c} />
          ))}
          <View className="flex-row">
            <SmallButton label="ล้างประวัติ" onPress={() => void sync.queue.clearConflicts()} />
          </View>
        </Section>
      )}

      <Section
        title="Supermemory"
        hint="ส่งความจำที่เพิ่ม/แก้ขึ้น space ร่วมของทีมอัตโนมัติ — ส่งไม่ผ่านก็ไม่กระทบแชท"
      >
        <Card>
          <ApiKeyInput
            storageKey={SUPERMEMORY_KEY_NAME}
            label="Supermemory API key"
            placeholder="sm_…"
            keyUrl="https://console.supermemory.ai"
          />
        </Card>
      </Section>
      <Section
        title="ดึง API key จาก Supermemory"
        hint="เก็บคีย์ของบอสไว้ใน Supermemory (บรรทัดละ ชื่อคีย์ = ค่า เช่น ai.gemini = AIza…) แล้วกดดึงมาใส่เครื่อง — ไม่ต้องกรอกใหม่ทุกครั้งที่ build"
      >
        <Card>
          <View className="flex-row">
            <SmallButton
              label={importing ? 'กำลังดึง…' : 'ดึงคีย์มาใส่เครื่อง'}
              tone="primary"
              disabled={importing}
              onPress={pullSecrets}
            />
          </View>
        </Card>
      </Section>
    </ScrollView>
  );
}

function ConflictRow({ conflict: c }: { conflict: ConflictLogEntry }) {
  const scope = targetLabel(c.target);
  const shown = (v: string | null) => v ?? '(ลบแล้ว)';
  return (
    <View
      className="gap-1 rounded-2xl border border-white/10 bg-white/5 p-3"
      accessibilityLabel={`conflict ${c.key}`}
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm font-semibold text-white">{c.key}</Text>
        <Text className="text-[11px]" style={{ color: scope.color ?? 'rgba(255,255,255,0.6)' }}>
          {scope.label}
        </Text>
      </View>
      <Detail label="เครื่องนี้" value={shown(c.localValue)} />
      <Detail label="Server" value={shown(c.serverValue)} />
      <Detail
        label="ใช้ค่า"
        value={`${c.resolvedTo === 'server' ? 'ของ Server' : 'ของเครื่องนี้'} · ${formatTime(c.at)}`}
      />
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-20 text-xs text-white/40">{label}</Text>
      <Text className="flex-1 text-xs text-white/80">{value}</Text>
    </View>
  );
}
