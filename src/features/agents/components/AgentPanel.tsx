import { useNavigation } from '@react-navigation/native';
import { Maximize2, X } from 'lucide-react-native';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import { AgentHost } from './AgentHost';

/** สูงสุดเท่านี้ เพื่อให้ยังเห็นแชทด้านบน */
export const AGENT_PANEL_MAX_HEIGHT = 300;

interface AgentPanelProps {
  agentId: string;
  onClose: () => void;
  /** วางเหนือช่องพิมพ์ (px จากขอบล่างของพื้นที่หน้าจอ) */
  bottom: number;
  onLayout?: (e: LayoutChangeEvent) => void;
  registry?: AgentRegistry;
}

/**
 * Agent Panel แบบ inline บนหน้าหลัก (absolute เหนือช่องพิมพ์ — ทุกอย่างบน MainScreen เป็น absolute)
 * ปุ่ม: ขยายเต็มจอ (ไปหน้า AgentScreen) · ปิด
 */
export function AgentPanel({ agentId, onClose, bottom, onLayout, registry = agentRegistry }: AgentPanelProps) {
  const navigation = useNavigation();
  const name = registry.getAgent(agentId)?.name ?? agentId;

  return (
    <View
      accessibilityLabel={`แผง ${name}`}
      className="absolute left-4 right-4 rounded-2xl border border-white/10 bg-neutral-900/95"
      style={{ bottom, maxHeight: AGENT_PANEL_MAX_HEIGHT, zIndex: 14 }}
      onLayout={onLayout}
    >
      <View className="flex-row items-center border-b border-white/10 px-3 py-2">
        <Text className="flex-1 text-sm font-semibold text-white">{name}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`เปิด ${name} เต็มจอ`}
          hitSlop={8}
          className="mr-3"
          onPress={() => {
            onClose();
            navigation.navigate('Agent', { agentId });
          }}
        >
          <Maximize2 size={16} color="#ffffffb3" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`ปิด ${name}`} hitSlop={8} onPress={onClose}>
          <X size={18} color="#ffffffb3" />
        </Pressable>
      </View>
      <View className="px-3" style={{ flexShrink: 1 }}>
        <AgentHost agentId={agentId} onClose={onClose} registry={registry} />
      </View>
    </View>
  );
}
