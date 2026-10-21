import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { ONNX_BROKEN_MESSAGE, isOnnxBroken, resetOnnxGuard } from '../../voice/onnxGuard';
import { recordSamples } from '../../voice/speaker/SpeakerService';
import { OnnxWakeModels } from '../../voice/wakeword/OnnxWakeModels';
import { buildTemplates, type WakeProfile } from '../../voice/wakeword/templates';
import {
  CALIBRATE_SECONDS,
  ENROLL_CLIPS,
  ENROLL_CLIP_SECONDS,
  WAKE_PHRASES,
  calibrateAndSave,
  resolveWake,
  scaleToInt16,
  wakeConfig,
  type WakeMode,
} from '../../voice/wakeword/wakeConfig';
import { wakeSettings } from '../../voice/wakeword/wakeSettings';
import { WakeWordService } from '../../voice/wakeword/WakeWordService';
import { whileMounted } from '../utils';
import { Card, SmallButton } from './ui';

const TEST_SECONDS = 15;

/**
 * คำปลุก: "เฮ่ อะตอม" (ลงทะเบียนเสียงตัวเอง + ปรับเทียบเกณฑ์จากเสียงจริง) หรือ "Hey Jarvis" (โมเดลสำเร็จรูป)
 * ปรับภายหลังได้ทุกอย่าง: เกณฑ์ความไว · ลงทะเบียน/ปรับเทียบใหม่ · ทดสอบสดดูคะแนนจริง
 */
export function WakeWordCard() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<WakeMode>('atom');
  const [profile, setProfile] = useState<WakeProfile | null>(null);
  const [jarvisThreshold, setJarvisThreshold] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [live, setLive] = useState<{ last: number; max: number; hits: number } | null>(null);
  /** ครั้งก่อนแอปเด้งตอนโหลดโมเดล (onnxGuard) */
  const [onnxBroken, setOnnxBroken] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);

  const reload = useCallback(async () => {
    const [on, m, p, jt, broken] = await Promise.all([
      wakeSettings.isEnabled(),
      wakeConfig.getMode(),
      wakeConfig.loadProfile(),
      wakeConfig.getJarvisThreshold(),
      isOnnxBroken(),
    ]);
    setOnnxBroken(broken);
    setEnabled(on);
    setMode(m);
    setProfile(p);
    setJarvisThreshold(jt);
  }, []);

  useEffect(
    () =>
      whileMounted(
        async () => void (await reload()),
        () => {},
      ),
    [reload],
  );
  useEffect(() => () => releaseRef.current?.(), []);

  /** ครอบงานที่ใช้ไมค์: ตัวฟังคำปลุกเบื้องหลังพักให้ + ปล่อยเสมอแม้ error */
  const withMic = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setStatus(null);
      releaseRef.current = wakeSettings.acquireMic();
      try {
        await voiceOrchestrator.requestMicrophone();
        await task();
      } catch (e) {
        setStatus(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        releaseRef.current?.();
        releaseRef.current = null;
        setBusy(false);
        await reload();
      }
    },
    [reload],
  );

  const enroll = () =>
    withMic(async () => {
      const base = new OnnxWakeModels();
      await base.warmUp();
      const clips: Float32Array[] = [];
      for (let i = 1; i <= ENROLL_CLIPS; i++) {
        setStatus(
          `ครั้งที่ ${i}/${ENROLL_CLIPS}: พูดว่า “${WAKE_PHRASES.atom}” ภายใน ${ENROLL_CLIP_SECONDS} วินาที (เว้นจังหวะตามปกติ)`,
        );
        clips.push(scaleToInt16(await recordSamples(ENROLL_CLIP_SECONDS)));
      }
      setStatus('กำลังสร้างเทมเพลต…');
      const templates = await buildTemplates(base, clips);
      setStatus(
        `ต่อไป: พูดประโยคทั่วไป ${CALIBRATE_SECONDS} วินาที เช่น เล่าเรื่องอะไรก็ได้ — ห้ามพูดคำปลุก`,
      );
      const { calibration } = await calibrateAndSave(base, templates);
      await wakeConfig.setMode('atom');
      setStatus(
        calibration.separated
          ? `✅ ลงทะเบียนสำเร็จ เกณฑ์ ${calibration.threshold} (คำปลุกต่ำสุด ${calibration.positiveMin} · เสียงทั่วไปสูงสุด ${calibration.negativeMax})`
          : `⚠️ ลงทะเบียนแล้วแต่แยกคำปลุกจากเสียงทั่วไปไม่ชัด (${calibration.positiveMin} เทียบ ${calibration.negativeMax}) — ลองใหม่ในที่เงียบ พูดชัด ๆ หรือใช้ Hey Jarvis`,
      );
    });

  const test = () =>
    withMic(async () => {
      const resolved = await resolveWake();
      if (!resolved) throw new Error('ยังไม่ได้ลงทะเบียนคำปลุก “เฮ่ อะตอม”');
      setLive({ last: 0, max: 0, hits: 0 });
      const service = new WakeWordService({
        models: resolved.models,
        options: resolved.options,
        onScore: (score, triggered) =>
          setLive((p) => ({
            last: score,
            max: Math.max(p?.max ?? 0, score),
            hits: (p?.hits ?? 0) + (triggered ? 1 : 0),
          })),
      });
      setStatus(`กำลังฟัง ${TEST_SECONDS} วินาที — ลองพูดคำปลุก แล้วลองพูดประโยคอื่นเทียบ`);
      await service.start(() => {});
      await new Promise<void>((r) => setTimeout(r, TEST_SECONDS * 1000));
      await service.stop();
      setStatus('ทดสอบเสร็จ — ถ้าคำปลุกไม่ตื่น ให้ลดเกณฑ์ · ถ้าตื่นมั่ว ให้เพิ่มเกณฑ์');
    });

  const adjust = async (delta: number) => {
    if (mode === 'jarvis') {
      const next = Math.min(
        0.95,
        Math.max(0.2, Math.round((jarvisThreshold + delta * 5) * 100) / 100),
      );
      await wakeConfig.setJarvisThreshold(next);
    } else if (profile) {
      const next = Math.min(
        0.995,
        Math.max(0.5, Math.round((profile.threshold + delta) * 1000) / 1000),
      );
      await wakeConfig.setProfileThreshold(next);
    }
    await reload();
  };

  const threshold = mode === 'jarvis' ? jarvisThreshold : profile?.threshold;

  return (
    <Card>
      <Text className="text-sm font-semibold text-white">คำปลุก</Text>
      {onnxBroken && (
        <View className="gap-2 rounded-xl bg-red-500/15 p-3">
          <Text className="text-xs leading-5 text-red-200">{ONNX_BROKEN_MESSAGE}</Text>
          <SmallButton
            label="ลองโหลดโมเดลอีกครั้ง"
            onPress={() => void resetOnnxGuard().then(() => setOnnxBroken(false))}
          />
        </View>
      )}
      <Text className="text-xs leading-5 text-white/50">
        พูดคำปลุกตอนเปิดแอปอยู่ เพื่อเริ่มคุยโดยไม่ต้องแตะ (ฟังบนเครื่อง
        ไม่ส่งเสียงออกไปจนกว่าจะตื่น) ไมค์เปิดตลอดจึงกินแบตเพิ่ม และ Android
        ไม่อนุญาตตอนแอปอยู่เบื้องหลัง · “เฮ่ อะตอม” เป็นการจับคู่กับเสียงที่ลงทะเบียน
        ความแม่นขึ้นกับเสียงจริงของคุณ จึงมีการปรับเทียบ ปรับความไว และทดสอบสดให้
      </Text>

      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-white/80">เปิดใช้คำปลุก</Text>
        <Switch
          value={enabled}
          onValueChange={(v) => {
            setEnabled(v);
            void wakeSettings.setEnabled(v);
          }}
          accessibilityLabel="เปิดใช้คำปลุก"
        />
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(['atom', 'jarvis'] as const).map((m) => (
          <SmallButton
            key={m}
            label={`${mode === m ? '● ' : ''}${WAKE_PHRASES[m]}`}
            tone={mode === m ? 'primary' : 'default'}
            disabled={busy}
            onPress={() => void wakeConfig.setMode(m).then(reload)}
          />
        ))}
      </View>

      {mode === 'atom' && (
        <Text className="text-xs text-white/60">
          {profile
            ? `ลงทะเบียนแล้ว ${profile.templates.length} เทมเพลต · เกณฑ์ ${profile.threshold}`
            : 'ยังไม่ได้ลงทะเบียน — กด “ลงทะเบียน” (ใช้เวลา ~35 วินาที: พูดคำปลุก 6 ครั้ง + พูดประโยคทั่วไป)'}
        </Text>
      )}
      {mode === 'jarvis' && (
        <Text className="text-xs text-white/60">
          โมเดลสำเร็จรูป พูดว่า “Hey Jarvis” · เกณฑ์ {jarvisThreshold}
        </Text>
      )}

      <View className="flex-row flex-wrap gap-2">
        {mode === 'atom' && (
          <SmallButton
            label={profile ? 'ลงทะเบียนใหม่' : 'ลงทะเบียน'}
            tone="primary"
            disabled={busy}
            onPress={() => void enroll()}
          />
        )}
        <SmallButton
          label="ทดสอบสด 15 วินาที"
          disabled={busy || (mode === 'atom' && !profile)}
          onPress={() => void test()}
        />
        {mode === 'atom' && profile && (
          <SmallButton
            label="ลบโปรไฟล์"
            tone="danger"
            disabled={busy}
            onPress={() => void wakeConfig.clearProfile().then(reload)}
          />
        )}
      </View>

      {threshold !== undefined && (
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-xs text-white/60">
            ความไว: เกณฑ์ {threshold} (ลด = ตื่นง่ายขึ้น · เพิ่ม = ตื่นยากขึ้น)
          </Text>
          <SmallButton
            label="−"
            disabled={busy}
            onPress={() => void adjust(-0.01)}
            accessibilityLabel="ลดเกณฑ์ (ไวขึ้น)"
          />
          <SmallButton
            label="+"
            disabled={busy}
            onPress={() => void adjust(0.01)}
            accessibilityLabel="เพิ่มเกณฑ์ (ไวน้อยลง)"
          />
        </View>
      )}

      {live && (
        <Text className="text-xs text-white/70">
          คะแนนล่าสุด {live.last.toFixed(2)} · สูงสุด {live.max.toFixed(2)} · ตื่น {live.hits} ครั้ง
        </Text>
      )}
      {status && <Text className="text-xs text-white/70">{status}</Text>}
      <Text className="text-[10px] text-white/30">
        โมเดลคำปลุก: openWakeWord (โมเดลสำเร็จรูป CC BY-NC-SA 4.0 — ใช้ส่วนตัว/ไม่เชิงพาณิชย์)
      </Text>
    </Card>
  );
}
