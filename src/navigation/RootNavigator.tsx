import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AgentScreen } from '../features/agents/screens/AgentScreen';
import { HistoryScreen } from '../features/jarvis/screens/HistoryScreen';
import { MainScreen } from '../features/jarvis/screens/MainScreen';
import { PluginMarketplaceScreen } from '../features/marketplace/screens/PluginMarketplaceScreen';
import { AssistantSettingsScreen } from '../features/settings/screens/AssistantSettingsScreen';
import { AISettingsScreen } from '../features/settings/screens/AISettingsScreen';
import { ModulesScreen } from '../features/settings/screens/ModulesScreen';
import { PersonaVoiceScreen } from '../features/settings/screens/PersonaVoiceScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';
import { PcBridgeScreen } from '../features/settings/screens/PcBridgeScreen';
import { SyncScreen } from '../features/settings/screens/SyncScreen';
import { VoiceSettingsScreen } from '../features/settings/screens/VoiceSettingsScreen';
import type { RootScreenProps, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const BG = '#05060a';

const THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: BG,
    card: BG,
    primary: '#38bdf8',
    border: '#ffffff1a',
  },
};

/** Marketplace อยู่ใต้ Modules — ส่งทางเข้าให้หน้า Modules (หน้าเองไม่ผูก navigation เพื่อให้ test render เดี่ยวได้) */
function ModulesRoute({ navigation }: RootScreenProps<'Modules'>) {
  return <ModulesScreen onOpenMarketplace={() => navigation.navigate('Marketplace')} />;
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={THEME}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: BG },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: BG },
        }}
      >
        <Stack.Screen name="Main" component={MainScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{ title: 'ประวัติการสนทนา' }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'ตั้งค่า' }} />
        <Stack.Screen
          name="AISettings"
          component={AISettingsScreen}
          options={{ title: 'AI Providers' }}
        />
        <Stack.Screen name="Modules" component={ModulesRoute} options={{ title: 'Modules' }} />
        <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sync' }} />
        <Stack.Screen
          name="PcBridge"
          component={PcBridgeScreen}
          options={{ title: 'Mark 55 Bus' }}
        />
        <Stack.Screen
          name="Marketplace"
          component={PluginMarketplaceScreen}
          options={{ title: 'Marketplace' }}
        />
        <Stack.Screen
          name="AssistantSettings"
          component={AssistantSettingsScreen}
          options={{ title: 'ผู้ช่วยส่วนตัว' }}
        />
        <Stack.Screen
          name="VoiceSettings"
          component={VoiceSettingsScreen}
          options={{ title: 'Voice (TTS + STT)' }}
        />
        <Stack.Screen
          name="PersonaVoice"
          component={PersonaVoiceScreen}
          options={{ title: 'Persona Voice Map' }}
        />
        <Stack.Screen name="Agent" component={AgentScreen} options={{ title: 'ผู้ช่วย' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
