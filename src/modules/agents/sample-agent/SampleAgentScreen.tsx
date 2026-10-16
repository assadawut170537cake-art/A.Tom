// src/modules/agents/sample-agent/SampleAgentScreen.tsx

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import type { AgentScreenProps } from '../../../core/agents/types';

export const SampleAgentScreen: React.FC<AgentScreenProps> = ({ agentId, onResult }) => {
  const [noteText, setNoteText] = useState('');
  const [shouldExplodeUI, setShouldExplodeUI] = useState(false);

  // 💣 จำลองสถานการณ์ UI พัง (Render Crash)
  if (shouldExplodeUI) {
    throw new Error('💥 จำลอง Render Crash สำเร็จ! Error Boundary ทำงานถูกต้อง');
  }

  const handleSave = () => {
    if (!noteText.trim()) {
      Alert.alert('แจ้งเตือน', 'กรุณากรอกข้อความก่อนบันทึก');
      return;
    }

    // ส่งข้อมูลกลับไปยังตัวกลาง
    if (onResult) {
      onResult({
        reply: `บันทึกข้อมูล "${noteText}" เรียบร้อยแล้ว`,
        data: { savedAt: new Date().toISOString(), content: noteText }
      });
    }
    setNoteText('');
    Alert.alert('สำเร็จ', 'บันทึกข้อมูลเข้าสู่ระบบเรียบร้อย');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>Agent ID: {agentId}</Text>
      <Text style={styles.title}>📝 Sample Note & Sandbox Lab</Text>
      <Text style={styles.subtitle}>หน้านี้ถูกโหลดเข้ามาแบบ Dynamic Lazy-Load</Text>

      {/* กล่องกรอกข้อมูลปกติ */}
      <TextInput
        style={styles.input}
        placeholder="พิมพ์ข้อความที่ต้องการบันทึก..."
        placeholderTextColor="#888"
        value={noteText}
        onChangeText={setNoteText}
      />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.btnText}>💾 บันทึกโน้ต (Normal Flow)</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* โซนทดสอบระเบิด UI */}
      <Text style={styles.warningText}>🧪 ทดสอบเกราะป้องกันหน้าจอขาว (UI Sandbox)</Text>
      <TouchableOpacity
        style={styles.crashBtn}
        onPress={() => setShouldExplodeUI(true)}
      >
        <Text style={styles.btnText}>💣 สั่งให้ UI ตัวเองพัง (Test Error Boundary)</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#16161A',
    borderRadius: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#2E2E38',
  },
  badge: { color: '#00E5FF', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { color: '#9E9EA7', fontSize: 12, marginBottom: 16 },
  input: {
    backgroundColor: '#24242C',
    borderRadius: 10,
    padding: 12,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: '#00C853',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  divider: { height: 1, backgroundColor: '#2E2E38', marginVertical: 20 },
  warningText: { color: '#FFB300', fontSize: 13, marginBottom: 8, fontWeight: 'bold' },
  crashBtn: {
    backgroundColor: '#D50000',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
});
