import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Main: undefined;
  Settings: undefined;
  AISettings: undefined;
  Modules: undefined;
  Marketplace: undefined;
  VoiceSettings: undefined;
  PersonaVoice: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

declare global {
  namespace ReactNavigation {
    // Lets useNavigation() be typed app-wide without generics
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
