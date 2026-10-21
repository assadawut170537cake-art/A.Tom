import '../global.css';

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootApp } from './boot';
import { installCrashGuard } from './features/jarvis/crashGuard';
import { useAtomStore } from './features/jarvis/stores/useAtomStore';
import { useTabsStore } from './features/jarvis/stores/useTabsStore';
import { RootNavigator } from './navigation/RootNavigator';

installCrashGuard();

// providers ลงทะเบียนทันที; module init + memory ทำงาน async ไม่บล็อก render และไม่ reject
void bootApp();

const allHydrated = () =>
  useAtomStore.persist.hasHydrated() &&
  useTabsStore.persist.hasHydrated() &&
  useAtomStore.getState().historyLoaded;

/** Wait for persisted persona / uiMode / tab / chat history so the first frame is already correct. */
function useStoresHydrated() {
  const [hydrated, setHydrated] = useState(allHydrated);

  useEffect(() => {
    const check = () => setHydrated(allHydrated());
    const unsubAtom = useAtomStore.persist.onFinishHydration(check);
    const unsubTabs = useTabsStore.persist.onFinishHydration(check);
    const unsubHistory = useAtomStore.subscribe((s, prev) => {
      if (s.historyLoaded !== prev.historyLoaded) check();
    });
    void useAtomStore.getState().loadHistory();
    check();
    return () => {
      unsubAtom();
      unsubTabs();
      unsubHistory();
    };
  }, []);

  return hydrated;
}

export default function App() {
  const hydrated = useStoresHydrated();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {hydrated ? <RootNavigator /> : <View style={{ flex: 1, backgroundColor: '#05060a' }} />}
    </SafeAreaProvider>
  );
}
