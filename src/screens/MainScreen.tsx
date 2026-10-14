import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatLayer } from '../features/jarvis/components/chat/ChatLayer';
import { BackgroundGradient } from '../features/jarvis/components/layout/BackgroundGradient';
import { Header } from '../features/jarvis/components/layout/Header';
import { TopSlot } from '../features/jarvis/components/layout/TopSlot';
import { ActionBar } from '../features/jarvis/components/navigation/ActionBar';
import { BottomTabs } from '../features/jarvis/components/navigation/BottomTabs';
import { IdleGreeting } from '../features/jarvis/components/orb/IdleGreeting';
import { ListeningIndicator } from '../features/jarvis/components/orb/ListeningIndicator';
import { OrbLayer } from '../features/jarvis/components/orb/OrbLayer';
import { LAYOUT, PERSONA_GREETINGS } from '../features/jarvis/constants';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { useTabsStore } from '../features/jarvis/stores/useTabsStore';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';

const GREETING_TOP = LAYOUT.dropdown.top + 58;

/**
 * Stand-in until STT input lands: walks the orb through
 * listening → thinking → speaking, pushes (and speaks) the persona's greeting and
 * switches to conversation mode.
 */
function useDemoGreeting() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancel = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    voiceOrchestrator.stop();
  }, []);

  useEffect(() => cancel, [cancel]);

  const greet = useCallback(() => {
    cancel();
    const { activePersona: persona, setMood, setUIMode, pushMessage } = useAtomStore.getState();
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

    setMood('listening');
    later(1400, () => setMood('thinking'));
    later(2600, () => {
      setMood('speaking');
      pushMessage({ role: 'assistant', content: PERSONA_GREETINGS[persona], persona });
      setUIMode('conversation');
      // Spoken with the persona's mapped voice (falls back to on-device Expo Speech)
      voiceOrchestrator.speak(PERSONA_GREETINGS[persona], persona).catch(() => {});
    });
    later(5600, () => setMood('idle'));
  }, [cancel]);

  return { greet, cancel };
}

function AtomTab() {
  const isIdle = useAtomStore((s) => s.uiMode === 'idle');
  const dropdownOpen = useAtomStore((s) => s.dropdownOpen);
  const closeDropdown = useAtomStore((s) => s.closeDropdown);
  const { greet, cancel } = useDemoGreeting();

  const onOrbPress = useCallback(() => {
    const { uiMode, setUIMode, setMood, closeDropdown: close } = useAtomStore.getState();
    close();
    if (uiMode === 'idle') {
      greet();
    } else {
      // Mini orb → back to idle so the persona can be switched
      cancel();
      setMood('idle');
      setUIMode('idle');
    }
  }, [greet, cancel]);

  return (
    <>
      <ChatLayer />
      <OrbLayer onPress={onOrbPress} />
      {isIdle && <IdleGreeting top={GREETING_TOP} />}
      <ListeningIndicator />
      <ActionBar onComputer={onOrbPress} />
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

function ComingSoon({ label }: { label: string }) {
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

  return (
    <View className="flex-1 bg-black">
      <BackgroundGradient />
      <View style={[StyleSheet.absoluteFill, { top: insets.top, bottom: insets.bottom }]}>
        <Header onSettings={() => navigation.navigate('Settings')} />
        {activeTab === 'atom' && <AtomTab />}
        {activeTab === 'today' && <ComingSoon label="Today" />}
        {activeTab === 'memory' && <ComingSoon label="Memory" />}
        <BottomTabs />
      </View>
    </View>
  );
}
