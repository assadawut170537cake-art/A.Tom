import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { isOnnxAvailable } from '../../voice/speaker/OnnxSpeakerModel';
import { wakeSettings } from '../../voice/wakeword/wakeSettings';
import {
  DEFAULT_THRESHOLD,
  EnrollError,
  SpeakerProfileStore,
  type SpeakerProfile,
} from '../../voice/speaker/profile';
import {
  ENROLL_PROMPT,
  ENROLL_SECONDS,
  enrollFromRecording,
  recordSamples,
} from '../../voice/speaker/SpeakerService';
import { whileMounted } from '../utils';
import { Card, SmallButton } from './ui';

const THRESHOLD_STEP = 0.05;
const THRESHOLD_MIN = 0.25;
const THRESHOLD_MAX = 0.75;

/**
 * ลงทะเบียน "เสียงของฉัน" — ให้ผู้ช่วยตอบเฉพาะเสียงเจ้าของ (กรองก่อนส่งเสียงขึ้นเซิร์ฟเวอร์ ช่วยประหยัดโทเคนด้วย)
 * เก็บเฉพาะเวกเตอร์ลักษณะเสียงใน SecureStore ไม่เก็บเสียงดิบ · ใช้ได้กับโหมดเสียงสด Gemini เท่านั้น
 */
export function SpeakerEnrollmentCard() {
  const [profile, setProfile] = useState<SpeakerProfile | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const available = isOnnxAvailable();
  const recording = elapsed !== null;

  useEffect(
    () =>
      whileMounted(
        async () =>
          [
            await SpeakerProfileStore.load(),
            await SpeakerProfileStore.isEnabled(),
            await SpeakerProfileStore.getThreshold(),
          ] as const,
        ([saved, on, th]) => {
          setProfile(saved);
          setEnabled(on);
          setThreshold(th);
        },
      ),
    [],
  );

  const enroll = useCallback(async () => {
    setMessage(null);
    const releaseMic = wakeSettings.acquireMic(); // พักตัวฟังคำปลุกระหว่างอัด (ใช้ไมค์พร้อมกันไม่ได้)
    try {
      await voiceOrchestrator.requestMicrophone();
      setElapsed(0);
      const samples = await recordSamples(ENROLL_SECONDS, { onProgress: setElapsed });
      setMessage('กำลังสร้างโปรไฟล์เสียง…');
      const { profile: created, consistency } = await enrollFromRecording(samples);
      setProfile(created);
      setEnabled(true);
      setMessage(`✅ ลงทะเบียนสำเร็จ (ความนิ่งของเสียง ${Math.round(consistency * 100)}%)`);
    } catch (e) {
      setMessage(`⚠️ ${e instanceof EnrollError || e instanceof Error ? e.message : String(e)}`);
    } finally {
      releaseMic();
      setElapsed(null);
    }
  }, []);

  const toggle = useCallback((value: boolean) => {
    setEnabled(value);
    void SpeakerProfileStore.setEnabled(value);
  }, []);

  const remove = useCallback(async () => {
    await SpeakerProfileStore.clear();
    await SpeakerProfileStore.setEnabled(false);
    setProfile(null);
    setEnabled(false);
    setMessage('ลบโปรไฟล์เสียงแล้ว');
  }, []);

  const adjust = useCallback(
    (delta: number) => {
      const next = Math.min(
        THRESHOLD_MAX,
        Math.max(THRESHOLD_MIN, Math.round((threshold + delta) * 100) / 100),
      );
      setThreshold(next);
      void SpeakerProfileStore.setThreshold(next);
    },
    [threshold],
  );

  return (
    <Card>
      <Text className="text-sm font-semibold text-white">ตอบเฉพาะเสียงของฉัน</Text>
      <Text className="text-xs leading-5 text-white/50">
        ลงทะเบียนเสียงครั้งเดียว แล้วผู้ช่วยจะส่งขึ้นเซิร์ฟเวอร์เฉพาะเสียงของคุณ —
        เสียงคนอื่น/ทีวีไม่ถูกส่งและไม่เสียโทเคน ใช้ได้กับโหมดเสียงสด Gemini บนมือถือ
        (ไม่ใช่ระบบความปลอดภัย: เสียงอัดเลียนแบบได้) เก็บเฉพาะลักษณะเสียงแบบเข้ารหัส
        ไม่เก็บไฟล์เสียง
      </Text>
      {!available && (
        <Text className="text-xs text-amber-300/80">
          ⚠️ build นี้ไม่มีโมดูล ONNX — ต้อง build ใหม่ (expo run:android) ก่อนใช้ระบบจำเสียง
        </Text>
      )}

      {profile && (
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-white/80">เปิดใช้การกรองเสียง</Text>
          <Switch
            value={enabled}
            onValueChange={toggle}
            accessibilityLabel="เปิดใช้การกรองเสียงของฉัน"
          />
        </View>
      )}

      {recording && (
        <View className="gap-2 rounded-xl bg-white/5 p-3">
          <Text className="text-xs text-white/60">
            พูดตามธรรมชาติ (อ่านข้อความนี้ซ้ำได้) · {elapsed}/{ENROLL_SECONDS} วินาที
          </Text>
          <Text className="text-sm leading-6 text-white/90">{ENROLL_PROMPT}</Text>
        </View>
      )}

      <View className="flex-row flex-wrap gap-2">
        <SmallButton
          label={profile ? 'ลงทะเบียนใหม่' : `ลงทะเบียนเสียง (${ENROLL_SECONDS} วินาที)`}
          tone="primary"
          disabled={recording || !available}
          onPress={() => void enroll()}
        />
        {profile && (
          <SmallButton
            label="ลบโปรไฟล์"
            tone="danger"
            disabled={recording}
            onPress={() => void remove()}
          />
        )}
      </View>

      {profile && (
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-xs text-white/60">
            ความเข้มงวด {threshold.toFixed(2)} (สูง = เข้ม
            แต่อาจตัดเสียงเราเองเวลาเสียงแหบ/มีเสียงรบกวน)
          </Text>
          <SmallButton
            label="−"
            onPress={() => adjust(-THRESHOLD_STEP)}
            accessibilityLabel="ลดความเข้มงวด"
          />
          <SmallButton
            label="+"
            onPress={() => adjust(THRESHOLD_STEP)}
            accessibilityLabel="เพิ่มความเข้มงวด"
          />
        </View>
      )}

      {message && <Text className="text-xs text-white/70">{message}</Text>}
      <Text className="text-[10px] text-white/30">
        โมเดล: WeSpeaker ResNet34 (CC-BY-4.0) — wespeaker.github.io
      </Text>
    </Card>
  );
}
