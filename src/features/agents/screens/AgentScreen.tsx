// src/features/agents/screens/AgentScreen.tsx

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';

import type { AgentScreenProps } from '../../../core/agents/types';
import { agentRegistry } from '../../../core/agents/AgentRegistry';
import { AgentErrorBoundary } from '../../../core/agents/components/AgentErrorBoundary';

export function AgentScreen() {
  const route = useRoute();
  const agentId = (route.params as { agentId?: string } | undefined)?.agentId ?? '';
  const [Component, setComponent] = useState<React.ComponentType<AgentScreenProps> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Comp = await agentRegistry.getScreenComponent(agentId);
        if (!cancelled && Comp) {
          setComponent(Comp);
        }
      } catch (e) {
        console.error('[AgentScreen] โหลดหน้าเอเจนไม่สำเร็จ', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={styles.text}>กำลังโหลดหน้าเอเจน…</Text>
      </View>
    );
  }

  if (!Component) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>ไม่พบหน้าจอของเอเจนนี้</Text>
      </View>
    );
  }

  return (
    <AgentErrorBoundary agentName={agentId}>
      <Component agentId={agentId} />
    </AgentErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#05060a',
  },
  text: {
    color: '#ffffff',
    marginTop: 12,
    fontSize: 16,
  },
});
