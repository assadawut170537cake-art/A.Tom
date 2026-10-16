import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { redactSecrets } from '../../http/errors';

interface Props {
  /** ชื่อ agent ที่แสดงในข้อความ */
  agentName?: string | undefined;
  children: ReactNode;
  /** เรียกหลังกด "ลองใหม่" (เช่น ให้ parent โหลด component ใหม่) */
  onRetry?: (() => void) | undefined;
}

interface State {
  error: Error | null;
}

/**
 * กัน UI ของ agent พังแล้วลากทั้งหน้าหลักล้มตาม — แสดงข้อความไทย + ปุ่มลองใหม่แทน
 * ต้องเป็น class component เพราะ React มี error boundary แบบ class เท่านั้น
 */
export class AgentErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[agents] UI ของ ${this.props.agentName ?? 'agent'} ล้ม`, redactSecrets(error.message), info.componentStack);
  }

  private readonly retry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View accessibilityRole="alert" className="items-center gap-2 p-4">
        <Text className="text-base font-semibold text-white">
          {`หน้าจอของ ${this.props.agentName ?? 'agent'} มีปัญหา`}
        </Text>
        <Text className="text-center text-sm text-white/60">{redactSecrets(error.message)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ลองใหม่"
          onPress={this.retry}
          className="mt-1 rounded-full bg-white/10 px-4 py-2"
        >
          <Text className="text-sm text-white">ลองใหม่</Text>
        </Pressable>
      </View>
    );
  }
}
