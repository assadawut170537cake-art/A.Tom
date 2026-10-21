import AsyncStorage from '@react-native-async-storage/async-storage';

const ENABLED_KEY = 'atom.wakeword.v1.enabled';

type Listener = () => void;
const listeners = new Set<Listener>();
let busyCount = 0;

/** เปิด/ปิดคำปลุก (จำค่าไว้ใน AsyncStorage) + แจ้งผู้ฟังเมื่อการตั้งค่าเปลี่ยน (หน้าตั้งค่า → useWakeWord) */
export const wakeSettings = {
  async isEnabled(): Promise<boolean> {
    return (await AsyncStorage.getItem(ENABLED_KEY)) === 'true';
  },
  async setEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(ENABLED_KEY, String(enabled));
    wakeSettings.notify();
  },
  /**
   * หน้าตั้งค่าที่ต้องใช้ไมค์ (ลงทะเบียน/ปรับเทียบ/ทดสอบ) ประกาศว่า "ไมค์ไม่ว่าง" — ตัวฟังคำปลุกพักจนกว่าจะเคลียร์
   * คืนฟังก์ชันปล่อย (เรียกซ้ำปลอดภัย)
   */
  acquireMic(): () => void {
    busyCount++;
    wakeSettings.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      busyCount = Math.max(0, busyCount - 1);
      wakeSettings.notify();
    };
  },
  isMicBusy(): boolean {
    return busyCount > 0;
  },
  /** แจ้งว่าการตั้งค่าคำปลุก (โหมด/เกณฑ์/โปรไฟล์) เปลี่ยน ให้ตัวฟังโหลดใหม่ */
  notify(): void {
    for (const l of listeners) l();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
