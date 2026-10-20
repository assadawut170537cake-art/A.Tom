import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { AttachmentRef } from '../../../core/types/attachment';

interface AttachmentChipsProps {
  files: AttachmentRef[];
  /** มี = แสดงปุ่ม X (ไฟล์ที่รอส่งในช่องพิมพ์) · ไม่มี = แสดงเฉย ๆ (ในบับเบิลแชท) */
  onRemove?: ((index: number) => void) | undefined;
}

const iconFor = (f: AttachmentRef) =>
  f.kind === 'image' ? ImageIcon : f.kind === 'text' || f.kind === 'pdf' ? FileText : Paperclip;

/** ชิปชื่อไฟล์แนบ — ใช้ทั้งเหนือช่องพิมพ์ (ลบได้) และในบับเบิลของบอส */
export function AttachmentChips({ files, onRemove }: AttachmentChipsProps) {
  if (!files.length) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {files.map((f, i) => {
        const Icon = iconFor(f);
        return (
          <View
            key={`${f.uri}-${i}`}
            className="max-w-[220px] flex-row items-center gap-1 rounded-full bg-white/15 py-1 pl-2.5 pr-2"
          >
            <Icon size={13} color="rgba(255,255,255,0.8)" strokeWidth={2} />
            <Text className="shrink text-xs text-white/90" numberOfLines={1}>
              {f.name}
            </Text>
            {onRemove && (
              <Pressable
                onPress={() => onRemove(i)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`เอาไฟล์ ${f.name} ออก`}
              >
                <X size={13} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
