import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';

import type { Persona } from '../../../../core/types/persona';
import { PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';

/**
 * ภาพโปรไฟล์และเตาปฏิกรณ์ประจำตัวของแต่ละ Persona สำหรับนำมาทำเป็น Wallpaper พื้นหลังแชท
 */
const PERSONA_AVATAR_SOURCES: Record<Persona, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  1: require('../../../../../assets/avatars/atom_avatar.jpg'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  2: require('../../../../../assets/avatars/jarvis_avatar.jpg'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  3: require('../../../../../assets/avatars/friday_avatar.jpg'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  4: require('../../../../../assets/avatars/ultron_avatar.jpg'),
};

/**
 * คอมโพเนนต์แสดงพื้นหลังแชทและ HUD แบบตอบสนองตาม Persona ที่เลือก พร้อมรูปภาพ Avatar โฮโลกราฟิกกึ่งโปร่งใส
 * @param props ไม่มีพารามิเตอร์ขาเข้า
 * @returns React.JSX.Element เลเยอร์พื้นหลังแชทพร้อม Gradient
 */
export function BackgroundGradient(): React.JSX.Element {
  try {
    const activePersona = useAtomStore((s) => s.activePersona);
    const uiMode = useAtomStore((s) => s.uiMode);
    const personaMeta = PERSONAS[activePersona] ?? PERSONAS[1];
    const color = personaMeta.color;
    const avatarSource = PERSONA_AVATAR_SOURCES[activePersona] ?? PERSONA_AVATAR_SOURCES[1];
    const isConversation = uiMode === 'conversation';

    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* เลเยอร์รูปภาพ Avatar โฮโลกราฟิกประจำตัวตัวละครในพื้นหลังแชท */}
        <Image
          source={avatarSource}
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: isConversation ? 0.16 : 0.07,
              resizeMode: 'cover',
            },
          ]}
        />

        {/* เลเยอร์ Gradient ไล่เฉดสีดำและแสงเรืองนีออนประจำ Persona เพื่อความสบายตาในการอ่านข้อความ */}
        <LinearGradient
          colors={['#05060af0', `${color}28`, '#05060add', '#000000fa']}
          locations={[0, 0.42, 0.75, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  } catch {
    // Fallback เมื่อเกิดข้อผิดพลาดในการโหลดรูปภาพ ให้แสดง Gradient สังเคราะห์แบบปลอดภัย
    return (
      <LinearGradient
        pointerEvents="none"
        colors={['#05060a', '#1e293b26', '#05060a', '#000000']}
        locations={[0, 0.42, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
    );
  }
}
