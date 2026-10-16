// src/modules/agents/route-escort/RouteEscortScreen.tsx
//
// Tactical HUD map screen for RouteEscortAgent.
// Uses react-native-maps (Google Maps provider) to draw:
//   - Polyline: escape route calculated by RouteEscortAgent
//   - Marker: ALPR cameras / checkpoints detected
//   - Circle: avoidance radius around each detected checkpoint
// Dark cyberpunk theme styled canvas.

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polyline, Marker, Circle } from 'react-native-maps';
import type { AgentScreenProps } from '../../../core/agents/types';

// Demo coordinates for Bangkok - Samut Prakan corridor.
const BANGKOK_COORDS = {
  latitude: 13.7563,
  longitude: 100.5018,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

// Polyline of the computed avoidance route (simulated).
const SAFE_ROUTE_POLYLINE = [
  { latitude: 13.7563, longitude: 100.5018 },
  { latitude: 13.7380, longitude: 100.5300 },
  { latitude: 13.7120, longitude: 100.5600 },
  { latitude: 13.6840, longitude: 100.6100 },
];

// Detected ALPR cameras / checkpoints (simulated).
const DETECTED_CHECKPOINTS = [
  {
    id: 'cam-1',
    latitude: 13.7450,
    longitude: 100.5150,
    title: '📸 กล้อง ALPR ตรวจจับป้ายทะเบียน',
    desc: 'ตรวจพบระบบ Flock Safety',
  },
  {
    id: 'cam-2',
    latitude: 13.7220,
    longitude: 100.5450,
    title: '👮 ด่านตรวจความมั่นคง',
    desc: 'รายงานล่าสุดโดยชุมชนเมื่อ 10 นาทีที่แล้ว',
  },
];

// Dark cyberpunk map style for the tactical HUD canvas.
const mapDarkStyle: any[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0f' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#eeeeee' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { featureType: 'road', stylers: [{ color: '#2a2a35' }] },
  { featureType: 'road.fill', stylers: [{ color: '#2a2a35' }] },
  { featureType: 'water', stylers: [{ color: '#0d1b2a' }] },
];
// src/modules/agents/route-escort/RouteEscortScreen.tsx
//
// Tactical HUD map screen for RouteEscortAgent.
// Lazy-loaded via getScreenComponent() and wrapped in AgentErrorBoundary by MainScreen.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import type { AgentScreenProps } from '../../../core/agents/types';

export const RouteEscortScreen: React.FC<AgentScreenProps> = ({ agentId, onResult }) => {
  const [route, setRoute] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<number>(0);

  const handleCalculate = () => {
    setRoute('คำนวณเส้นทางเลี่ยงด่านแล้ว (จำลอง Tactical HUD)');
    setCheckpoints(6);
    if (onResult) {
      onResult({
        reply: 'คำนวณเส้นทางเลี่ยงด่านเรียบร้อยแล้วครับ',
        data: { screen: 'route-escort-hud', agentId },
      });
    }
  };

  const handleScan = () => {
    Alert.alert('สแกน ALPR', 'พบจุดตรวจ / กล้อง ALPR 6 จุดในรัศมีเส้นทาง');
    if (onResult) {
      onResult({
        reply: 'สแกนกล้อง ALPR เรียบร้อยแล้วครับ',
        data: { screen: 'route-escort-hud', agentId, checkpoints: 6 },
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🛡️ Route Escort HUD</Text>
        <Text style={styles.subtitle}>สายตรวจ · ALPR Avoidance · Tactical Map</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Agent ID:</Text>
        <Text style={styles.infoValue}>{agentId}</Text>
        <Text style={styles.infoLabel}>Mode:</Text>
        <Text style={styles.infoValue}>Avoidance Navigation</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.btn} onPress={handleCalculate}>
          <Text style={styles.btnText}>🗺️ คำนวณเส้นทางเลี่ยงด่าน</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnScan} onPress={handleScan}>
          <Text style={styles.btnText}>📡 สแกน ALPR</Text>
        </TouchableOpacity>
      </View>

      {route && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>สรุปเส้นทาง</Text>
          <Text style={styles.resultText}>{route}</Text>
          <Text style={styles.resultText}>
            จุดตรวจที่หลบเลี่ยง: {checkpoints} จุด (รัศมีปลอดภัย 250 ม.)
          </Text>
        </View>
      )}

      <View style={styles.hint}>
        <Text style={styles.hintText}>
          หน้านี้ถูกโหลดแบบ Lazy-Load และถูกครอบด้วย AgentErrorBoundary
        </Text>
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
    backgroundColor: '#16161a',
    borderWidth: 1,
    borderColor: '#2e2e38',
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
    backgroundColor: '#00c853',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnScan: {
    flex: 1,
    backgroundColor: '#3b82f6',
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
    backgroundColor: '#16161a',
    borderWidth: 1,
    borderColor: '#2e2e38',
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
