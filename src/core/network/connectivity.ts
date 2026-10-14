import * as Network from 'expo-network';

/**
 * True only when the OS positively reports no connection. An unknown state (fields missing, or
 * the native module failing) counts as online so a flaky check never blocks a request.
 */
export async function isOffline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch (e) {
    console.error('[network] ตรวจสอบสถานะเครือข่ายไม่ได้', e);
    return false;
  }
}
