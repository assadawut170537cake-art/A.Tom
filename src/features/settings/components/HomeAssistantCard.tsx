import { Text } from 'react-native';

import { request } from '../../../core/http/request';
import { HA_TOKEN_KEY, loadHaConfig } from '../../assistant/agents/homeAssistant';
import { ApiKeyInput } from './ApiKeyInput';
import { OptionInput } from './OptionInput';
import { TestConnectionButton } from './TestConnectionButton';
import { Card } from './ui';

/** ทดสอบ: GET {url}/api/ ด้วย token → Home Assistant ตอบ {"message":"API running."} */
async function testHomeAssistant(): Promise<{ ok: boolean; error?: string }> {
  const config = await loadHaConfig();
  if (!config) return { ok: false, error: 'ใส่ URL และ Access Token ก่อน' };
  try {
    await request('home-assistant', `${config.url}/api/`, {
      headers: { Authorization: `Bearer ${config.token}` },
      timeoutMs: 10_000,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Home Assistant: สั่งไฟ/พัดลม/ม่าน ฯลฯ ด้วยเสียง — ใส่ URL ในวงเดียวกับมือถือ + Long-Lived Access Token */
export function HomeAssistantCard() {
  return (
    <Card>
      <Text className="text-sm font-semibold text-white">Home Assistant (บ้านอัจฉริยะ)</Text>
      <Text className="text-xs leading-5 text-white/50">
        สั่ง “เปิดไฟห้องนั่งเล่น” ได้หลังตั้งค่า · สร้าง Long-Lived Access Token ได้ที่หน้าโปรไฟล์ใน
        Home Assistant · สั่งได้เฉพาะไฟ สวิตช์ พัดลม ม่าน ฉาก มีเดีย แอร์
        (ไม่แตะประตูล็อกหรือสัญญาณกันขโมย)
      </Text>
      <OptionInput
        scope="homeassistant"
        name="url"
        label="Home Assistant URL"
        placeholder="http://192.168.1.10:8123"
      />
      <ApiKeyInput storageKey={HA_TOKEN_KEY} label="Long-Lived Access Token" />
      <TestConnectionButton test={testHomeAssistant} />
    </Card>
  );
}
