import { useLayoutEffect } from 'react';
import { Text, View } from 'react-native';

import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import type { RootScreenProps } from '../../../navigation/types';
import { AgentHost } from '../components/AgentHost';

/** หน้า UI ของ agent แบบเต็มจอ (route `Agent` · param `agentId`) */
export function AgentScreen({
  navigation,
  route,
  registry = agentRegistry,
}: RootScreenProps<'Agent'> & { registry?: AgentRegistry }) {
  const { agentId } = route.params;
  const agent = registry.getAgent(agentId);

  useLayoutEffect(() => {
    if (agent) navigation.setOptions({ title: agent.name });
  }, [agent, navigation]);

  if (!agent) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-center text-base text-white/70">{`ไม่พบผู้ช่วย "${agentId}" — อาจถูกถอดออกไปแล้ว`}</Text>
      </View>
    );
  }
  return (
    <View className="flex-1 p-4">
      <AgentHost agentId={agentId} onClose={() => navigation.goBack()} registry={registry} />
    </View>
  );
}
