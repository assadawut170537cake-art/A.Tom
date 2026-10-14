import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import type { MemoryTarget } from '../../../core/memory/types';
import { DEFAULT_PERSONA, PERSONA_IDS, type Persona } from '../../../core/types/persona';
import { PERSONAS } from '../../jarvis/constants';
import { MAX_VALUE_LENGTH, validateDraft, type FactDraft, type ScopedFact } from '../factModel';

/** ส้มของอะตอม = สีหลักของแอป */
const ACCENT = PERSONAS[1].color;

interface FactEditorProps {
  visible: boolean;
  /** null = เพิ่มใหม่ · มีค่า = แก้ไขตัวนี้ */
  editing: ScopedFact | null;
  /** คืนข้อความ error (เช่น key ซ้ำ / บันทึกไม่สำเร็จ) หรือ null เมื่อสำเร็จ */
  onSave: (draft: FactDraft) => Promise<string | null>;
  onCancel: () => void;
  /** แสดงปุ่มลบเมื่อแก้ไขของเดิม */
  onDelete?: ((fact: ScopedFact) => void) | undefined;
}

/** Modal เพิ่ม/แก้ความจำ: key + ค่า + ขอบเขต (Global หรือ persona หนึ่งตัว) */
export function FactEditor({ visible, ...form }: FactEditorProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={form.onCancel}>
      {/* mount ใหม่ทุกครั้งที่เปิด → ฟอร์มเริ่มจากค่าของรายการที่แก้ (หรือว่าง) โดยไม่ต้อง reset state */}
      {visible && <FactForm {...form} />}
    </Modal>
  );
}

function FactForm({ editing, onSave, onCancel, onDelete }: Omit<FactEditorProps, 'visible'>) {
  const [key, setKey] = useState(editing?.fact.key ?? '');
  const [value, setValue] = useState(editing?.fact.value ?? '');
  const [scope, setScope] = useState<MemoryTarget['scope']>(editing?.target.scope ?? 'global');
  const [persona, setPersona] = useState<Persona>(
    editing?.target.scope === 'persona' ? editing.target.persona : DEFAULT_PERSONA
  );
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errors = validateDraft({ key, value });
  // key ผิดรูปแบบเตือนทันทีที่พิมพ์ · ช่องว่างเตือนหลังกดบันทึกครั้งแรก
  const keyError = errors.key && (touched || key !== '') ? errors.key : undefined;
  const valueError = touched ? errors.value : undefined;
  const target: MemoryTarget = scope === 'global' ? { scope: 'global' } : { scope: 'persona', persona };

  const save = async () => {
    setTouched(true);
    if (errors.key || errors.value || saving) return;
    setSaving(true);
    const error = await onSave({ key: key.trim(), value: value.trim(), target });
    setSaving(false);
    setSaveError(error);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 justify-end bg-black/60"
    >
      <View className="rounded-t-3xl border-t border-white/10 bg-neutral-900 px-5 pb-8 pt-5">
        <Text className="mb-4 text-lg font-semibold text-white" accessibilityRole="header">
          {editing ? 'แก้ไขความจำ' : 'เพิ่มความจำ'}
        </Text>

        <Text className="mb-1.5 text-xs font-medium text-white/60">ชื่อ (key)</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="เช่น favorite_drink"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="ชื่อ key"
          className="rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
        />
        {keyError && <FieldError text={keyError} />}

        <View className="mb-1.5 mt-4 flex-row items-center justify-between">
          <Text className="text-xs font-medium text-white/60">สิ่งที่ให้จำ</Text>
          <Text className="text-[11px] text-white/40" accessibilityLabel="จำนวนตัวอักษร">
            {value.length}/{MAX_VALUE_LENGTH}
          </Text>
        </View>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="เช่น บอสชอบกาแฟดำ ไม่ใส่น้ำตาล"
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
          maxLength={MAX_VALUE_LENGTH}
          accessibilityLabel="สิ่งที่ให้จำ"
          className="min-h-[72px] rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white"
          style={{ textAlignVertical: 'top' }}
        />
        {valueError && <FieldError text={valueError} />}

        <Text className="mb-1.5 mt-4 text-xs font-medium text-white/60">ใครจำ</Text>
        <View className="flex-row gap-2" accessibilityRole="radiogroup">
          <Choice label="Global (ทุกผู้ช่วย)" selected={scope === 'global'} onPress={() => setScope('global')} />
          <Choice label="Persona" selected={scope === 'persona'} onPress={() => setScope('persona')} />
        </View>
        {scope === 'persona' && (
          <View className="mt-2 flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {PERSONA_IDS.map((id) => (
              <Choice
                key={id}
                label={PERSONAS[id].name}
                color={PERSONAS[id].color}
                selected={persona === id}
                onPress={() => setPersona(id)}
              />
            ))}
          </View>
        )}

        {saveError && <FieldError text={saveError} />}

        <View className="mt-6 flex-row gap-3">
          {editing && onDelete && (
            <Pressable
              onPress={() => onDelete(editing)}
              accessibilityRole="button"
              accessibilityLabel="ลบความจำ"
              className="rounded-xl border border-red-400/40 px-4 py-3 active:bg-red-500/20"
            >
              <Text className="text-sm font-medium text-red-300">ลบ</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="ยกเลิก"
            className="flex-1 items-center rounded-xl border border-white/15 py-3 active:bg-white/10"
          >
            <Text className="text-sm font-medium text-white/80">ยกเลิก</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="บันทึก"
            accessibilityState={{ disabled: saving }}
            className="flex-1 items-center rounded-xl py-3 active:opacity-80"
            style={{ backgroundColor: ACCENT, opacity: saving ? 0.5 : 1 }}
          >
            <Text className="text-sm font-semibold text-white">บันทึก</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function FieldError({ text }: { text: string }) {
  return (
    <Text className="mt-1.5 text-xs text-red-300" accessibilityRole="alert">
      {text}
    </Text>
  );
}

interface ChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string | undefined;
}

function Choice({ label, selected, onPress, color = ACCENT }: ChoiceProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
      style={{ borderColor: selected ? color : 'rgba(255,255,255,0.15)', backgroundColor: selected ? `${color}33` : 'transparent' }}
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: selected ? color : 'rgba(255,255,255,0.3)' }} />
      <Text className="text-xs text-white">{label}</Text>
    </Pressable>
  );
}
