import { Mic, MicOff, SendHorizontal } from 'lucide-react-native';
import { useState, type Ref } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { PERSONAS } from '../../constants';

/** ตรงกับ leading-6 ของ ChatBubble — สระ/วรรณยุกต์ไทยไม่โดนตัด */
const LINE_HEIGHT = 24;
const MAX_LINES = 4;
const PADDING_Y = 8;
/** สูงสุด 4 บรรทัด เกินนั้น scroll ภายในช่อง */
export const CHAT_INPUT_MAX_HEIGHT = LINE_HEIGHT * MAX_LINES + PADDING_Y * 2;

interface ChatInputProps {
  /** ได้ข้อความที่ trim แล้ว (ไม่ถูกเรียกเมื่อว่าง) */
  onSend: (text: string) => void;
  /**
   * ห้ามส่งระหว่างผู้ช่วยกำลังคิด/พูด — แต่ยังพิมพ์ร่างข้อความถัดไปได้
   * (ถ้าปิด editable คีย์บอร์ดจะหุบเองทุกครั้งที่ผู้ช่วยเริ่มคิด)
   */
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  /** สีปุ่มส่ง — ค่าเริ่มต้นคือสีส้มของอะตอม */
  accentColor?: string | undefined;
  onFocus?: (() => void) | undefined;
  ref?: Ref<TextInput> | undefined;
  /** มี = แสดงปุ่มไมค์ (เข้า/ออกโหมดคุยด้วยเสียง) */
  onVoice?: (() => void) | undefined;
  /** โหมดคุยด้วยเสียงทำงานอยู่ — ปุ่มไมค์กลายเป็นปุ่มหยุด */
  voiceActive?: boolean | undefined;
  /** ห้ามเริ่มโหมดเสียง (เช่นผู้ช่วยกำลังตอบข้อความที่พิมพ์) — กดหยุดได้เสมอ */
  voiceDisabled?: boolean | undefined;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'พิมพ์ข้อความ…',
  accentColor = PERSONAS[1].color,
  onFocus,
  ref,
  onVoice,
  voiceActive = false,
  voiceDisabled = false,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const canSend = !disabled && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <View className="flex-row items-end gap-2 rounded-3xl border border-white/10 bg-white/[0.08] py-1 pl-4 pr-1">
      <TextInput
        ref={ref}
        value={text}
        onChangeText={setText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.4)"
        selectionColor={accentColor}
        cursorColor={accentColor}
        multiline
        accessibilityLabel="ช่องพิมพ์ข้อความ"
        className="flex-1 text-[15px] text-white"
        style={{
          lineHeight: LINE_HEIGHT,
          paddingTop: PADDING_Y,
          paddingBottom: PADDING_Y,
          maxHeight: CHAT_INPUT_MAX_HEIGHT,
          textAlignVertical: 'center',
        }}
      />
      {onVoice && (
        <Pressable
          onPress={onVoice}
          disabled={voiceDisabled && !voiceActive}
          accessibilityRole="button"
          accessibilityLabel={voiceActive ? 'หยุดคุยด้วยเสียง' : 'คุยด้วยเสียง'}
          accessibilityState={{ disabled: voiceDisabled && !voiceActive, selected: voiceActive }}
          hitSlop={6}
          className="mb-0.5 h-9 w-9 items-center justify-center rounded-full"
          style={{
            backgroundColor: voiceActive ? accentColor : 'rgba(255,255,255,0.1)',
            opacity: voiceDisabled && !voiceActive ? 0.4 : 1,
          }}
        >
          {voiceActive ? (
            <MicOff size={18} color="#ffffff" strokeWidth={2} />
          ) : (
            <Mic size={18} color="rgba(255,255,255,0.85)" strokeWidth={2} />
          )}
        </Pressable>
      )}
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="ส่งข้อความ"
        accessibilityState={{ disabled: !canSend }}
        hitSlop={6}
        className="mb-0.5 h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: canSend ? accentColor : 'rgba(255,255,255,0.1)' }}
      >
        <SendHorizontal size={18} color={canSend ? '#ffffff' : 'rgba(255,255,255,0.4)'} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
