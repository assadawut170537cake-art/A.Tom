// src/core/agents/components/AgentErrorBoundary.tsx

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';

interface Props {
  children: ReactNode;
  agentName: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AgentErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("🚨 [UI Crash Log] ตรวจพบหน้าจอเอเจนทำงานผิดพลาด:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.icon}>⚡</Text>
          <Text style={styles.title}>หน้าจอส่วนขยาย &quot;{this.props.agentName}&quot; ขัดข้อง</Text>
          <Text style={styles.detail}>{this.state.errorMessage}</Text>
          <Button title="พยายามรีโหลดเฉพาะส่วนนี้" onPress={this.handleReset} color="#E53935" />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorBox: {
    padding: 20,
    backgroundColor: '#1E1E24',
    borderWidth: 1,
    borderColor: '#E53935',
    borderRadius: 12,
    margin: 12,
    alignItems: 'center',
  },
  icon: { fontSize: 32, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: 'bold', color: '#FFF', marginBottom: 4 },
  detail: { fontSize: 12, color: '#FF8A80', marginBottom: 12, textAlign: 'center' },
});
