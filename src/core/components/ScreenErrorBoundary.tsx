import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { redactSecrets } from '../http/errors';

interface Props {
  /** ชื่อหน้า (route) — ใส่ในข้อความให้รู้ว่าหน้าไหนพัง */
  screen: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * กันหน้าจอพังแล้วแอปเด้ง — release build ไม่มีจอแดง error ใน render = แอปปิดทันที (Boss เจอ 2026-10-21)
 * แสดงข้อความ error จริง (redact แล้ว) ให้บอสส่งต่อได้ · กด "ลองใหม่" = render หน้าเดิมอีกครั้ง
 * ⚠️ กันได้เฉพาะ error ฝั่ง JS — native crash (เช่น SIGSEGV ใน .so) ต้องดู logcat
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = (info.componentStack ?? '').trim().split('\n').slice(0, 6).join('\n');
    this.setState({ stack });
    console.error(`[screen] หน้า ${this.props.screen} ล้ม`, redactSecrets(error.message), stack);
  }

  private readonly retry = () => this.setState({ error: null, stack: '' });

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12 }}
        style={{ backgroundColor: '#05060a' }}
      >
        <View accessibilityRole="alert">
          <Text className="text-lg font-semibold text-white">{`หน้า ${this.props.screen} มีปัญหา`}</Text>
          <Text className="mt-1 text-sm text-white/60">
            แคปจอนี้ส่งให้ทีมแก้ได้เลย — แอปไม่ปิดแล้ว กดย้อนกลับเพื่อใช้หน้าอื่นต่อได้
          </Text>
        </View>
        <Text selectable className="rounded-xl bg-white/10 p-3 text-xs text-red-300">
          {`${error.name}: ${redactSecrets(error.message)}${stack ? `\n\n${redactSecrets(stack)}` : ''}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ลองใหม่"
          onPress={this.retry}
          className="self-start rounded-full bg-white/15 px-5 py-2.5"
        >
          <Text className="text-sm text-white">ลองใหม่</Text>
        </Pressable>
      </ScrollView>
    );
  }
}
