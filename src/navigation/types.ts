import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Main: undefined;
  /** ประวัติการสนทนา (ปุ่มนาฬิกาซ้ายบนของหน้าหลัก) */
  History: undefined;
  Settings: undefined;
  AISettings: undefined;
  Modules: undefined;
  Sync: undefined;
  PcBridge: undefined;
  Marketplace: undefined;
  VoiceSettings: undefined;
  PersonaVoice: undefined;
  /** UI ของ agent แบบเต็มจอ */
  Agent: { agentId: string };
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
