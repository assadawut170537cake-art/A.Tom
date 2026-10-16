import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainScreen } from '../features/jarvis/screens/MainScreen';
import { PluginMarketplaceScreen } from '../features/marketplace/screens/PluginMarketplaceScreen';
import { AISettingsScreen } from '../features/settings/screens/AISettingsScreen';
import { ModulesScreen } from '../features/settings/screens/ModulesScreen';
import { PersonaVoiceScreen } from '../features/settings/screens/PersonaVoiceScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';
import { SyncScreen } from '../features/settings/screens/SyncScreen';
import { VoiceSettingsScreen } from '../features/settings/screens/VoiceSettingsScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const BG = '#05060a';

const THEME: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: BG, card: BG, primary: '#38bdf8', border: '#ffffff1a' },
};

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
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'ตั้งค่า' }} />
        <Stack.Screen name="AISettings" component={AISettingsScreen} options={{ title: 'AI Providers' }} />
        <Stack.Screen name="Modules" component={ModulesScreen} options={{ title: 'Modules' }} />
        <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sync' }} />
        <Stack.Screen name="Marketplace" component={PluginMarketplaceScreen} options={{ title: 'Marketplace' }} />
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
