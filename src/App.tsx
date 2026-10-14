import '../global.css';

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerAIProviders } from './features/ai';
import { useAtomStore } from './features/jarvis/stores/useAtomStore';
import { useTabsStore } from './features/jarvis/stores/useTabsStore';
import { registerVoiceProviders } from './features/voice';
import { RootNavigator } from './navigation/RootNavigator';

registerAIProviders();
registerVoiceProviders();

const allHydrated = () => useAtomStore.persist.hasHydrated() && useTabsStore.persist.hasHydrated();

/** Wait for persisted persona / uiMode / tab so the first frame is already correct. */
function useStoresHydrated() {
  const [hydrated, setHydrated] = useState(allHydrated);

  useEffect(() => {
    const check = () => setHydrated(allHydrated());
    const unsubAtom = useAtomStore.persist.onFinishHydration(check);
    const unsubTabs = useTabsStore.persist.onFinishHydration(check);
    check();
    return () => {
      unsubAtom();
      unsubTabs();
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
