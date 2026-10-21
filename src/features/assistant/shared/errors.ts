/** error ที่มีข้อความไทยพร้อมแสดงให้ผู้ใช้ (AgentHandler นำไปต่อท้าย "<agent>ทำงานไม่สำเร็จครับ — …") */
export class AssistantError extends Error {}

/** โหลด native module แบบ lazy — ไม่มี (Expo Go / jest / ยังไม่ build ใหม่) = บอกวิธีแก้เป็นภาษาไทย */
export function loadNative<T>(load: () => T, label: string): T {
  try {
    return load();
  } catch {
    throw new AssistantError(
      `ฟีเจอร์ ${label} ต้องใช้ development build ที่มีโมดูลนี้ — build ใหม่ด้วย expo run:android`,
    );
  }
}
