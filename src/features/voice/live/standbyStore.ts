/**
 * @file โหมดเฝ้า (อัลตรอน · ADR-015 ขั้น 4) — เปิดค้างไว้ = ฟังตลอดจนกว่าบอสจะปิด แม้สลับไปแอปอื่น
 *
 * เก็บค่าใน AsyncStorage `atom.voice.v1.standby` → เปิดแอปใหม่แล้วเริ่มฟังเองถ้าเปิดค้างไว้
 * `useLiveVoice` ฟัง store นี้: เปิด → เริ่มโหมดไลฟ์แบบไม่ออกเอง · ปิด → หยุดไมค์
 * สั่งได้ 3 ทาง: สวิตช์ใน ตั้งค่า › เสียง · พิมพ์/พูด "เปิดโหมดเฝ้า" / "ปิดโหมดเฝ้า" · แตะ Orb ระหว่างเฝ้า = ปิด
 * ไม่ใช่ Foreground Service ของเราเอง — ใช้ของ expo-audio (background recording + แจ้งเตือนค้าง) ไปก่อน
 */

import { create } from 'zustand';

import { readJSON, writeJSON } from '../../../core/storage/jsonStorage';
import { isBoolean } from '../../../core/types/guards';

export const STANDBY_STORAGE_KEY = 'atom.voice.v1.standby';

interface StandbyState {
  enabled: boolean;
  /** โหลดค่าที่บันทึกแล้ว — ก่อนหน้านี้ไม่เริ่มไมค์เอง (กันเปิดแล้วปิดทันที) */
  loaded: boolean;
  load(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
}

let loading: Promise<void> | null = null;

export const useStandbyStore = create<StandbyState>((set, get) => ({
  enabled: false,
  loaded: false,
  load() {
    return (loading ??= readJSON(STANDBY_STORAGE_KEY, isBoolean)
      .then((saved) => {
        // บอสสั่งก่อนโหลดเสร็จ → ค่าที่สั่งชนะ
        if (!get().loaded) set({ enabled: saved ?? false, loaded: true });
      })
      .catch((e: unknown) => {
        console.error('[voice] อ่านค่าโหมดเฝ้าไม่ได้ — ปิดไว้ก่อน', e);
        set({ loaded: true });
      }));
  },
  async setEnabled(on) {
    set({ enabled: on, loaded: true });
    try {
      await writeJSON(STANDBY_STORAGE_KEY, on);
    } catch (e) {
      // จำไม่ได้แค่รอบหน้า — รอบนี้ยังทำงานตามที่สั่ง
      console.error('[voice] บันทึกค่าโหมดเฝ้าไม่ได้', e);
    }
  },
}));

/** ใช้ใน test — ล้างสถานะ + cache การโหลด */
export function resetStandbyStore(): void {
  loading = null;
  useStandbyStore.setState({ enabled: false, loaded: false });
}
