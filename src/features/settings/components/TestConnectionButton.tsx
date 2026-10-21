import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { SmallButton } from './ui';

type Status =
  { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'error'; message: string };

interface TestConnectionButtonProps {
  test: () => Promise<{ ok: boolean; error?: string }>;
  label?: string;
}

/** Runs a provider's testConnection() and shows the result inline. */
export function TestConnectionButton({
  test,
  label = 'ทดสอบการเชื่อมต่อ',
}: TestConnectionButtonProps) {
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  const run = async () => {
    setStatus({ state: 'testing' });
    try {
      const res = await test();
      setStatus(
        res.ok ? { state: 'ok' } : { state: 'error', message: res.error ?? 'ไม่ทราบสาเหตุ' },
      );
    } catch (e) {
      setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <SmallButton label={label} disabled={status.state === 'testing'} onPress={run} />
        {status.state === 'testing' && <ActivityIndicator size="small" color="#fff" />}
        {status.state === 'ok' && <Text className="text-sm text-emerald-300">✓ เชื่อมต่อได้</Text>}
      </View>
      {status.state === 'error' && (
        <Text className="text-xs leading-5 text-red-300" accessibilityLiveRegion="polite">
          {status.message}
        </Text>
      )}
    </View>
  );
}
