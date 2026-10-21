import { redactSecrets } from '../../core/http/errors';
import { useAtomStore } from './stores/useAtomStore';

let installed = false;

/**
 * error ฝั่ง JS ที่หลุดออกนอก React (เช่น throw ใน onPress / callback ของ native) — release build ปิดแอปทันที
 * ตัวนี้แสดงเป็นข้อความ ⚠️ ในแชทแทน (บอสแคปส่งทีมได้) แล้วให้แอปทำงานต่อ (Boss เจอแอปเด้ง 2026-10-21)
 * error ตอน render ถูก ScreenErrorBoundary จับก่อนแล้ว · native crash จับไม่ได้ (ต้องดู logcat)
 */
export function installCrashGuard(): void {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try {
      useAtomStore.getState().pushMessage({
        role: 'system',
        content: `⚠️ แอปเจอข้อผิดพลาด (แอปยังทำงานต่อ) — แคปส่งทีมได้\n${redactSecrets(message).slice(0, 400)}`,
      });
    } catch {
      // store ใช้ไม่ได้ (ตอนเปิดแอปเร็วมาก) → ให้ตัวเดิมจัดการ
      previous(error, isFatal);
      return;
    }
    console.error('[crash-guard]', redactSecrets(message));
    if (__DEV__) previous(error, isFatal); // dev ยังเห็นจอแดงตามปกติ
  });
}
