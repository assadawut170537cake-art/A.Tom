import { useNetworkState } from 'expo-network';
import { Text, View } from 'react-native';

import { LAYOUT } from '../../constants';

/** Thin notice under the header while the device reports no connection (AI chat needs internet). */
export function OfflineBanner() {
  const { isConnected, isInternetReachable } = useNetworkState();
  if (isConnected !== false && isInternetReachable !== false) return null;
  return (
    <View
      accessibilityRole="alert"
      className="absolute left-4 right-4 rounded-full bg-red-500/20 px-3 py-1"
      style={{ top: LAYOUT.header.height, zIndex: 30 }}
    >
      <Text className="text-center text-xs text-red-200">
        ออฟไลน์อยู่ — แชทกับ AI ต้องใช้อินเทอร์เน็ต
      </Text>
    </View>
  );
}
