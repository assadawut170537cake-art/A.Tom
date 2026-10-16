import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { AgentErrorBoundary } from '../../../core/agents/components/AgentErrorBoundary';
import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import type { AgentScreenComponent } from '../../../core/agents/types';
import { redactSecrets } from '../../../core/http/errors';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; Screen: AgentScreenComponent }
  | { status: 'missing' }
  | { status: 'error'; message: string };

interface AgentHostProps {
  agentId: string;
  onClose: () => void;
  registry?: AgentRegistry;
}

/**
 * โหลด UI ของ agent แบบ lazy แล้วครอบด้วย AgentErrorBoundary — ใช้ร่วมกันทั้ง Agent Panel และ AgentScreen
 * "ลองใหม่" (ทั้งตอนโหลดล้มและตอน UI พัง) = โหลด component ใหม่ + mount ใหม่หมด
 */
export function AgentHost({ agentId, onClose, registry = agentRegistry }: AgentHostProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // agent หรือรอบลองใหม่เปลี่ยน → กลับไปสถานะกำลังโหลด (ปรับตอน render แทน setState ใน effect)
  const [loadKey, setLoadKey] = useState(`${agentId}#${attempt}`);
  if (loadKey !== `${agentId}#${attempt}`) {
    setLoadKey(`${agentId}#${attempt}`);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    let active = true;
    registry
      .getScreenComponent(agentId)
      .then((Screen) => {
        if (active) setState(Screen ? { status: 'ready', Screen } : { status: 'missing' });
      })
      .catch((e: unknown) => {
        console.error(`[agents] โหลดหน้าจอของ ${agentId} ไม่ได้`, e);
        if (active) setState({ status: 'error', message: redactSecrets(e instanceof Error ? e.message : String(e)) });
      });
    return () => {
      active = false;
    };
  }, [agentId, attempt, registry]);

  const name = registry.getAgent(agentId)?.name ?? agentId;

  switch (state.status) {
    case 'loading':
      return (
        <View className="items-center p-4">
          <ActivityIndicator accessibilityLabel={`กำลังโหลด ${name}`} color="#ffffff" />
        </View>
      );
    case 'missing':
      return <Text className="p-3 text-sm text-white/60">{`${name} ไม่มีหน้าจอให้แสดง`}</Text>;
    case 'error':
      return (
        <View accessibilityRole="alert" className="items-center gap-2 p-4">
          <Text className="text-base font-semibold text-white">{`โหลดหน้าจอของ ${name} ไม่สำเร็จ`}</Text>
          <Text className="text-center text-sm text-white/60">{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ลองใหม่"
            onPress={retry}
            className="mt-1 rounded-full bg-white/10 px-4 py-2"
          >
            <Text className="text-sm text-white">ลองใหม่</Text>
          </Pressable>
        </View>
      );
    case 'ready': {
      const { Screen } = state;
      return (
        <AgentErrorBoundary key={attempt} agentName={name} onRetry={retry}>
          <Screen agentId={agentId} onClose={onClose} />
        </AgentErrorBoundary>
      );
    }
  }
}
