import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import { MemoryBusClient } from '../../pc-bridge/MemoryBusClient';
import { failureAdvice } from '../../pc-bridge/PcBridgeModule';
import {
  DEVICE_TOKEN_PATTERN,
  normalizeProjectUrl,
  pcBridgeSettings,
  type PcBridgeConfig,
  type PcBridgeSettingsStore,
} from '../../pc-bridge/settings';
import { Card, FieldLabel, Section, SmallButton } from '../components/ui';

interface Notice {
  tone: 'info' | 'error';
  text: string;
}

/** ไม่มีงานรหัสนี้แน่นอน — ใช้ทดสอบว่า token ผ่าน (ได้ null กลับมา) โดยไม่ต้องสร้างงานจริง */
const PROBE_TASK_ID = '00000000-0000-4000-8000-000000000000';

export interface PcBridgeScreenProps {
  settings?: PcBridgeSettingsStore;
  probe?: (config: PcBridgeConfig) => Promise<unknown>;
}

const defaultProbe = (config: PcBridgeConfig) => new MemoryBusClient(config).getTask(PROBE_TASK_ID);

const REGISTER_SQL = "select public.mobile_register_device('boss-phone', 'มือถือ Boss');";

const INPUT_CLASS = 'rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white';

/** ตั้งค่า › Mark 55 Bus: Project URL + anon key + token เครื่อง สำหรับสั่งงาน Mark 55 จากแชท */
export function PcBridgeScreen({ settings = pcBridgeSettings, probe = defaultProbe }: PcBridgeScreenProps) {
  const [saved, setSaved] = useState<PcBridgeConfig | null>(null);
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let alive = true;
    void settings.load().then((config) => {
      if (!alive) return;
      setSaved(config);
      if (config) setUrl(config.url);
    });
    return () => {
      alive = false;
    };
  }, [settings]);

  /** ช่อง key/token ว่าง = ใช้ค่าที่บันทึกไว้ (ไม่แสดง secret เดิมซ้ำบนจอ) */
  const draft = (): PcBridgeConfig | string => {
    const normalized = normalizeProjectUrl(url);
    if ('error' in normalized) return normalized.error;
    const key = anonKey.trim() || saved?.anonKey || '';
    const tok = token.trim() || saved?.token || '';
    if (!key) return 'ใส่ anon key (หรือ publishable key) จาก Supabase › Settings › API';
    if (!DEVICE_TOKEN_PATTERN.test(tok)) return 'token เครื่องต้องขึ้นต้นด้วย atm_ ตามด้วยตัวอักษร 64 ตัว';
    return { url: normalized.url, anonKey: key, token: tok };
  };

  const save = async () => {
    const config = draft();
    if (typeof config === 'string') {
      setNotice({ tone: 'error', text: config });
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      await settings.save(config);
      setSaved(config);
      setUrl(config.url);
      setAnonKey('');
      setToken('');
      setNotice({ tone: 'info', text: 'บันทึกแล้ว — ลองพิมพ์ในแชทว่า "สั่งคอมเช็กสถานะเครื่อง"' });
    } catch (e) {
      setNotice({ tone: 'error', text: `บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const config = draft();
    if (typeof config === 'string') {
      setNotice({ tone: 'error', text: config });
      return;
    }
    setBusy('test');
    setNotice(null);
    try {
      await probe(config);
      setNotice({ tone: 'info', text: 'เชื่อมต่อได้ — token ใช้งานได้' });
    } catch (e) {
      setNotice({ tone: 'error', text: failureAdvice(e) });
    } finally {
      setBusy(null);
    }
  };

  const clear = () =>
    Alert.alert('ลบการเชื่อมต่อ Mark 55 Bus?', 'ลบ URL, anon key และ token ออกจากเครื่องนี้', [
      { text: 'ไม่ใช่', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: () => {
          void settings.clear().then(() => {
            setSaved(null);
            setUrl('');
            setAnonKey('');
            setToken('');
            setNotice({ tone: 'info', text: 'ลบแล้ว' });
          });
        },
      },
    ]);

  return (
    <ScrollView className="flex-1 bg-[#05060a]" contentContainerClassName="p-4 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="mb-5 px-1 text-xs leading-5 text-white/50">
        สั่งงาน Mark 55 จากแชท (เช็กเครื่อง · บิลด์) ผ่าน Supabase — token เครื่องออกได้ใน Supabase SQL Editor:
        {`\n${REGISTER_SQL}`}
      </Text>

      {notice && (
        <Text
          accessibilityRole={notice.tone === 'error' ? 'alert' : 'text'}
          className={`mb-5 rounded-xl border px-3 py-2 text-xs ${
            notice.tone === 'error' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/5 text-white/80'
          }`}
        >
          {notice.text}
        </Text>
      )}

      <Section title="เชื่อมต่อ" hint={saved ? 'ตั้งค่าไว้แล้ว — เว้นช่อง key/token ว่างไว้เพื่อใช้ค่าเดิม' : undefined}>
        <Card>
          <View>
            <FieldLabel>Project URL</FieldLabel>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://<project-ref>.supabase.co"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Project URL"
              className={INPUT_CLASS}
            />
          </View>
          <View>
            <FieldLabel>anon / publishable key</FieldLabel>
            <TextInput
              value={anonKey}
              onChangeText={setAnonKey}
              placeholder={saved ? '•••• (บันทึกไว้แล้ว)' : 'sb_publishable_… หรือ eyJ…'}
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="anon key"
              className={INPUT_CLASS}
            />
          </View>
          <View>
            <FieldLabel>Token เครื่อง</FieldLabel>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder={saved ? '•••• (บันทึกไว้แล้ว)' : 'atm_…'}
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="Token เครื่อง"
              className={INPUT_CLASS}
            />
            <Text className="mt-1 text-[11px] text-white/40">ห้ามใส่ service_role key ที่นี่ — ใช้เฉพาะบน Mark 55</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <SmallButton
              label={busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
              tone="primary"
              disabled={busy !== null}
              onPress={() => void save()}
            />
            <SmallButton
              label={busy === 'test' ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
              disabled={busy !== null}
              onPress={() => void test()}
            />
            {saved && <SmallButton label="ลบการเชื่อมต่อ" tone="danger" disabled={busy !== null} onPress={clear} />}
          </View>
        </Card>
      </Section>
    </ScrollView>
  );
}
