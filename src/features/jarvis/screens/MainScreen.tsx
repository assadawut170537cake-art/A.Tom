import { useNavigation } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentPanel } from '../../agents/components/AgentPanel';
import { useAgentPanelStore } from '../../agents/stores/useAgentPanelStore';
import { MemoryScreen } from '../../memory/screens/MemoryScreen';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { ApiKeyNotice } from '../components/chat/ApiKeyNotice';
import { ChatInput } from '../components/chat/ChatInput';
import { ChatLayer } from '../components/chat/ChatLayer';
import { BackgroundGradient } from '../components/layout/BackgroundGradient';
import { Header } from '../components/layout/Header';
import { OfflineBanner } from '../components/layout/OfflineBanner';
import { TopSlot } from '../components/layout/TopSlot';
import { ActionBar } from '../components/navigation/ActionBar';
import { BottomTabs } from '../components/navigation/BottomTabs';
import { IdleGreeting } from '../components/orb/IdleGreeting';
import { ListeningIndicator } from '../components/orb/ListeningIndicator';
import { LiveVoiceStatus } from '../components/orb/LiveVoiceStatus';
import { OrbLayer } from '../components/orb/OrbLayer';
import { LAYOUT, PERSONAS } from '../constants';
import { useAIKeyStatus } from '../hooks/useAIKeyStatus';
import { useKeyboardOverlap } from '../hooks/useKeyboardOverlap';
import { useLiveVoice } from '../hooks/useLiveVoice';
import { sendMessage } from '../services/conversation';
import { useAtomStore } from '../stores/useAtomStore';
import { useTabsStore } from '../stores/useTabsStore';

const GREETING_TOP = LAYOUT.dropdown.top + 58;
/** แถว ActionBar สูงเท่าปุ่มกลาง (คอมพิวเตอร์ 60px) */
const ACTION_BAR_HEIGHT = 60;
const GAP = 8;
/** ช่องพิมพ์วางเหนือ ActionBar ตอนคีย์บอร์ดปิด (ไม่แก้ค่า LAYOUT ที่ lock ไว้) */
const COMPOSER_BOTTOM = LAYOUT.actionBar.bottom + ACTION_BAR_HEIGHT + 12;

interface AtomTabProps {
  /** คีย์บอร์ดบังขอบล่างของพื้นที่หน้าจออยู่กี่ px */
  keyboardOverlap: number;
}

function AtomTab({ keyboardOverlap }: AtomTabProps) {
  const navigation = useNavigation();
  const isIdle = useAtomStore((s) => s.uiMode === 'idle');
  const dropdownOpen = useAtomStore((s) => s.dropdownOpen);
  const closeDropdown = useAtomStore((s) => s.closeDropdown);
  // ส่งได้เฉพาะตอนผู้ช่วยว่าง — conversation.sendMessage เป็นคนเดิน mood thinking → speaking → idle
  const busy = useAtomStore((s) => s.mood === 'thinking' || s.mood === 'speaking');
  const persona = PERSONAS[useAtomStore((s) => s.activePersona)];
  const keyStatus = useAIKeyStatus();

  const live = useLiveVoice();

  const agentId = useAgentPanelStore((s) => s.agentId);
  const closeAgent = useAgentPanelStore((s) => s.close);

  const inputRef = useRef<TextInput>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  const enterConversation = useCallback(() => {
    const { uiMode, setUIMode, closeDropdown: close } = useAtomStore.getState();
    close();
    if (uiMode === 'idle') setUIMode('conversation');
  }, []);

  const onOrbPress = useCallback(() => {
    // โหมดคุยด้วยเสียงทำงานอยู่ → แตะ = หยุดโหมดเสียงอย่างเดียว (ยังอยู่หน้าคุย)
    if (live.active) {
      live.stop();
      return;
    }
    if (useAtomStore.getState().uiMode === 'idle') {
      // เข้าโหมดคุยแล้วเปิดช่องพิมพ์ — ไม่มีข้อความทักทาย demo แล้ว (คำทักทายใช้เฉพาะตอนสั่งสลับ persona)
      enterConversation();
      focusInput();
    } else {
      // Orb เล็ก → กลับหน้าเลือกผู้ช่วย; หยุดเสียงที่พูดค้าง แล้ว sendMessage จะคืน mood เป็น idle เอง
      voiceOrchestrator.stop();
      Keyboard.dismiss();
      useAgentPanelStore.getState().close();
      useAtomStore.getState().setUIMode('idle');
    }
  }, [enterConversation, focusInput, live]);

  /** กดค้าง Orb / ปุ่มไมค์ → เข้าโหมดคุยด้วยเสียง (ห้ามเริ่มระหว่างผู้ช่วยตอบข้อความที่พิมพ์ — ไมค์จะได้ยินเสียงพูด) */
  const startLive = useCallback(() => {
    if (live.active || busy) return;
    Keyboard.dismiss();
    live.start();
  }, [live, busy]);

  const toggleLive = useCallback(() => {
    if (live.active) live.stop();
    else startLive();
  }, [live, startLive]);

  const onSend = useCallback((text: string) => {
    // sendMessage จับ error ทุกกรณีเองแล้วแสดงเป็นข้อความ ⚠️ ในแชท — ไม่ reject
    void sendMessage(text);
  }, []);

  const composerBottom = keyboardOverlap > 0 ? keyboardOverlap + GAP : COMPOSER_BOTTOM;
  // Agent Panel อยู่เหนือช่องพิมพ์ → ดันรายการแชทขึ้นตามความสูง panel
  const panelBottom = composerBottom + composerHeight + GAP;
  const chatBottom = Math.max(
    LAYOUT.chat.bottomPadding,
    panelBottom + (agentId ? panelHeight + GAP : 0)
  );

  return (
    <>
      <ChatLayer bottom={chatBottom} />
      <OrbLayer onPress={onOrbPress} onLongPress={startLive} liveActive={live.active} />
      {isIdle && <IdleGreeting top={GREETING_TOP} />}
      {/* โหมดไลฟ์ใช้ mood listening ด้วย แต่แสดงสถานะเองใน LiveVoiceStatus */}
      {!live.active && <ListeningIndicator />}
      <ActionBar onComputer={onOrbPress} onKeyboard={focusInput} />
      <View
        className="absolute left-4 right-4"
        style={{ bottom: composerBottom, zIndex: 13 }}
        onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
      >
        {keyStatus === 'missing' && (
          <ApiKeyNotice onPress={() => navigation.navigate('AISettings')} />
        )}
        <LiveVoiceStatus state={live.state} color={persona.color} />
        <ChatInput
          ref={inputRef}
          onSend={onSend}
          // โหมดเสียงทำงานอยู่ = ห้ามส่งข้อความพิมพ์ซ้อน (สองรอบจะแย่งกันพูด)
          disabled={busy || live.active}
          onVoice={toggleLive}
          voiceActive={live.active}
          voiceDisabled={busy}
          onFocus={enterConversation}
          placeholder={`พิมพ์ข้อความถึง${persona.name}…`}
          accentColor={persona.color}
        />
      </View>
      {agentId && (
        <AgentPanel
          agentId={agentId}
          onClose={closeAgent}
          bottom={panelBottom}
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
        />
      )}
      {dropdownOpen && (
        <Pressable
          accessibilityLabel="ปิดเมนู"
          onPress={closeDropdown}
          style={[StyleSheet.absoluteFill, { zIndex: 15 }]}
        />
      )}
      <TopSlot />
    </>
  );
}

interface ComingSoonProps {
  label: string;
}

function ComingSoon({ label }: ComingSoonProps) {
  return (
    <View className="absolute inset-0 items-center justify-center">
      <Text className="text-lg font-semibold text-white/80">{label}</Text>
      <Text className="mt-1 text-sm text-white/40">เร็วๆ นี้</Text>
    </View>
  );
}

export function MainScreen() {
  const insets = useSafeAreaInsets();
  const activeTab = useTabsStore((s) => s.activeTab);
  const navigation = useNavigation();
  const containerRef = useRef<View>(null);
  const { overlap, onContainerLayout } = useKeyboardOverlap(containerRef);

  return (
    <View className="flex-1 bg-black">
      <BackgroundGradient />
      <View
        ref={containerRef}
        onLayout={onContainerLayout}
        style={[StyleSheet.absoluteFill, { top: insets.top, bottom: insets.bottom }]}
      >
        <Header onSettings={() => navigation.navigate('Settings')} />
        <OfflineBanner />
        {activeTab === 'atom' && <AtomTab keyboardOverlap={overlap} />}
        {activeTab === 'today' && <ComingSoon label="Today" />}
        {activeTab === 'memory' && <MemoryScreen />}
        <BottomTabs />
      </View>
    </View>
  );
}
