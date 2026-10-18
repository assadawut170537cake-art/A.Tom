import { FileText, X } from 'lucide-react-native';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import type { Attachment } from '../../../../core/types/message';

interface AttachmentStripProps {
  attachments: Attachment[];
  /** มี = แสดงปุ่ม × (รายการรอส่ง) · ไม่มี = แสดงอย่างเดียว (ในบับเบิล) */
  onRemove?: ((id: string) => void) | undefined;
  /** ขนาดรูปย่อ */
  size?: number;
}

/** รูปย่อ/ชื่อไฟล์ของไฟล์แนบ — ใช้ทั้งเหนือช่องพิมพ์และในบับเบิลข้อความ */
export function AttachmentStrip({ attachments, onRemove, size = 64 }: AttachmentStripProps) {
  if (!attachments.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
      {attachments.map((a) => (
        <View key={a.id} className="relative">
          {a.kind === 'image' ? (
            <Image
              source={{ uri: a.uri }}
              accessibilityLabel={`รูป ${a.name}`}
              className="rounded-xl bg-white/10"
              style={{ width: size, height: size }}
            />
          ) : (
            <View
              className="flex-row items-center gap-1.5 rounded-xl bg-white/10 px-3"
              style={{ height: size, maxWidth: 200 }}
            >
              <FileText size={18} color="rgba(255,255,255,0.8)" />
              <Text numberOfLines={2} className="flex-shrink text-xs text-white/80">
                {a.name}
              </Text>
            </View>
          )}
          {onRemove && (
            <Pressable
              onPress={() => onRemove(a.id)}
              accessibilityRole="button"
              accessibilityLabel={`เอา ${a.name} ออก`}
              hitSlop={8}
              className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-neutral-700"
            >
              <X size={12} color="#fff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
