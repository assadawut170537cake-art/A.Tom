import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { aiRegistry } from '../../ai/core/ProviderRegistry';
import {
  addCustomProvider,
  loadCustomProviders,
  removeCustomProvider,
  validateCustomProvider,
  type CustomProviderDef,
} from '../../ai/customProviders';
import { whileMounted } from '../utils';
import { ProviderCard } from './ProviderCard';
import { Card, FieldLabel, SmallButton } from './ui';

const INPUT = 'rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white';

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View>
      <FieldLabel>{props.label}</FieldLabel>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={props.label}
        className={INPUT}
      />
    </View>
  );
}

/**
 * เพิ่มผู้ให้บริการ AI เอง (OpenAI-compatible) — ADR-020 · เพิ่มแล้วได้การ์ดเหมือนเจ้าในตัว (key / โมเดล / ทดสอบ)
 * ใช้ได้กับ Groq, Together, DeepInfra, Ollama ในบ้าน, LM Studio ฯลฯ — อะไรก็ได้ที่มี `/chat/completions`
 */
export function CustomProviders() {
  const [defs, setDefs] = useState<CustomProviderDef[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', baseURL: '', defaultModel: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => whileMounted(loadCustomProviders, setDefs), []);

  const add = async () => {
    const result = validateCustomProvider(form, defs);
    if ('error' in result) return setError(result.error);
    setError(null);
    await addCustomProvider(result);
    setDefs((d) => [...d, result]);
    setForm({ name: '', baseURL: '', defaultModel: '' });
    setOpen(false);
  };

  const remove = async (id: CustomProviderDef['id']) => {
    await removeCustomProvider(id);
    setDefs((d) => d.filter((x) => x.id !== id));
  };

  return (
    <View className="gap-3">
      {defs.map((def) => {
        const provider = aiRegistry.get(def.id);
        return (
          <View key={def.id} className="gap-1.5">
            {provider && <ProviderCard provider={provider} subtitle={def.baseURL} />}
            <View className="flex-row justify-end">
              <SmallButton label={`ลบ ${def.name}`} tone="danger" onPress={() => remove(def.id)} />
            </View>
          </View>
        );
      })}
      {open ? (
        <Card>
          <Field
            label="ชื่อ"
            value={form.name}
            onChange={(name) => setForm((f) => ({ ...f, name }))}
            placeholder="เช่น Groq"
          />
          <Field
            label="Base URL"
            value={form.baseURL}
            onChange={(baseURL) => setForm((f) => ({ ...f, baseURL }))}
            placeholder="https://api.groq.com/openai/v1"
          />
          <Field
            label="โมเดลเริ่มต้น"
            value={form.defaultModel}
            onChange={(defaultModel) => setForm((f) => ({ ...f, defaultModel }))}
            placeholder="ชื่อโมเดลตามเอกสารของผู้ให้บริการ"
          />
          {error && <Text className="text-xs text-red-300">{error}</Text>}
          <View className="flex-row gap-2">
            <SmallButton label="เพิ่ม" tone="primary" onPress={add} />
            <SmallButton label="ยกเลิก" onPress={() => setOpen(false)} />
          </View>
        </Card>
      ) : (
        <SmallButton label="+ เพิ่มผู้ให้บริการเอง" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}
