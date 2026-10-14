import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import { ProviderError } from '../../../core/http/errors';

const DENIED = 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน';
const OPEN_SETTINGS = 'เปิดสิทธิ์ได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › ไมโครโฟน';

/**
 * Makes sure the app may record before STT starts. Throws a `permission` ProviderError (never
 * falls back: no STT provider can work without the microphone) with a Thai message telling the
 * user where to fix it.
 */
export async function ensureMicPermission(): Promise<void> {
  let granted: boolean;
  let canAskAgain: boolean;
  try {
    ({ granted, canAskAgain } = await getRecordingPermissionsAsync());
    if (!granted && canAskAgain) ({ granted, canAskAgain } = await requestRecordingPermissionsAsync());
  } catch (e) {
    console.error('[voice] ขอสิทธิ์ไมโครโฟนไม่สำเร็จ', e);
    throw new ProviderError('voice', 'permission', `${DENIED} (ขอสิทธิ์ไม่สำเร็จ)`);
  }
  if (!granted) {
    throw new ProviderError('voice', 'permission', canAskAgain ? DENIED : `${DENIED} — ${OPEN_SETTINGS}`);
  }
}
