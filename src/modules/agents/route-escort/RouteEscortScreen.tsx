// src/modules/agents/route-escort/RouteEscortScreen.tsx
//
// หน้าจอ HUD ให้ RouteEscortAgent (agent ที่ลงทะเบียนใน boot)
// โหลดแบบ lazy เมื่อเอเจนขอเรียบร้อยแล้ว
//
// UI ไม่ได้พึ่ง react-native-maps (ยังไม่ลงทะเบียนใน main) ใช้ summary
// และรายการจุดตรวจจาก engine โดยตรง

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import type { AgentScreenProps } from '../../../core/agents/types';
import {
  calculateAvoidanceRoute,
  FALLBACK_CHECKPOINTS,
  DEFAULT_RADIUS_METERS,
} from './checkpoints';

// เซตพิกัด demo สำหรับทดสอบเชื่อมต่อ engine (Bangkok–Samut Prakan corridor)
const DEMO_ORIGIN = { lat: 13.68, lon: 100.74 };
const DEMO_DESTINATION = { lat: 13.70, lon: 100.76 };

export const RouteEscortScreen: React.FC<AgentScreenProps> = ({ agentId, onClose }) => {
  const [summary, setSummary] = useState<string | null>(null);

  const handleCalculate = () => {
    const route = calculateAvoidanceRoute(DEMO_ORIGIN, DEMO_DESTINATION, FALLBACK_CHECKPOINTS);
    const lines = [
      `เลี่ยงด่านที่หลบ: ${route.avoidedCheckpointsCount} จุด`,
      `ระยะทาง: ${route.distanceKm.toFixed(2)} กม.`,
      `ประมาณ: ${Math.round(route.durationMin)} นาที`,
      `จุดพิกัด: ${route.waypoints.length} จุด`,
    ];
    setSummary(lines.join('\n'));
  };

  const handleScan = () => {
    const labels = FALLBACK_CHECKPOINTS.map((c) => `${c.id} (${c.type})`);
    Alert.alert('สแกนจุดตรวจ / กล้อง ALPR', `${labels.join('\n')}\nระยะปลอดภัย: ${DEFAULT_RADIUS_METERS} ม.`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🛡️ Route Escort HUD</Text>
        <Text style={styles.subtitle}>สายตรวจ · ALPR Avoidance · Tactical Map</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Agent ID</Text>
        <Text style={styles.infoValue}>{agentId}</Text>
        <Text style={styles.infoLabel}>Mode</Text>
        <Text style={styles.infoValue}>Avoidance Navigation</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.btn} onPress={handleCalculate}>
          <Text style={styles.btnText}>🗺️ คำนวณเส้นทางเลี่ยงด่าน</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnScan} onPress={handleScan}>
          <Text style={styles.btnText}>📡 สแกนจุดตรวจ</Text>
        </TouchableOpacity>
      </View>

      {summary !== null && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>สรุปเส้นทาง</Text>
          <Text style={styles.resultText}>{summary}</Text>
          <Text style={styles.resultText}>ระยะปลอดภัยรอบด่าน: {DEFAULT_RADIUS_METERS} ม.</Text>
          <Text style={styles.resultText}>จุดตรวจที่ใช้: {FALLBACK_CHECKPOINTS.length} จุด</Text>
        </View>
      )}

      <View style={styles.hint}>
        <Text style={styles.hintText}>หน้านี้โหลดแบบ Lazy-Load และอยู่ภายใต้ AgentErrorBoundary</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#00e5ff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#9ea3b2',
    fontSize: 14,
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: '#166161a',
    borderWidth: 1,
    borderColor: '#2e2e388',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoLabel: {
    color: '#9ea3b2',
    fontSize: 12,
    marginBottom: 4,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  btn: {
    flex: 1,
    backgroundColor: '#000c853',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnScan: {
    flex: 1,
    backgroundColor: '#3bb82f6',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  resultCard: {
    backgroundColor: '#166161a',
    borderWidth: 1,
    borderColor: '#2e2e388',
    borderRadius: 12,
    padding: 16,
  },
  resultTitle: {
    color: '#00e5ff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resultText: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  hint: {
    marginTop: 20,
    alignItems: 'center',
  },
  hintText: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
  },
});
