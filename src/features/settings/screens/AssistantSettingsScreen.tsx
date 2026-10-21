import { ScrollView, Text } from 'react-native';

import { HomeAssistantCard } from '../components/HomeAssistantCard';
import { Section } from '../components/ui';
import { WakeWordCard } from '../components/WakeWordCard';

/** ผู้ช่วยส่วนตัว: คำปลุก · Home Assistant (ความสามารถอื่นสั่งด้วยเสียง/ข้อความได้เลย) */
export function AssistantSettingsScreen() {
  return (
    <ScrollView
      className="flex-1 bg-[#05060a]"
      contentContainerClassName="p-4 pb-16"
      keyboardShouldPersistTaps="handled"
    >
      <Section title="คำปลุก" hint="เริ่มคุยด้วยการพูด ไม่ต้องแตะ">
        <WakeWordCard />
      </Section>
      <Section title="บ้านอัจฉริยะ">
        <HomeAssistantCard />
      </Section>
      <Text className="px-1 text-xs leading-5 text-white/40">
        สั่งได้เลยไม่ต้องตั้งค่า: ค้นเว็บ · ปฏิทิน · ตั้งปลุก/จับเวลา · โทร/ส่งข้อความ
        (เปิดหน้าให้กดเอง) · อากาศ/ร้านใกล้ฉัน · สร้างรูป · ดูด้วยกล้อง · เตือนความจำ/สรุปเช้า ·
        สร้างผู้ช่วยเฉพาะทาง (“สร้างผู้ช่วยชื่อ …”) — ครั้งแรกระบบจะขอสิทธิ์ที่เกี่ยวข้อง
      </Text>
    </ScrollView>
  );
}
