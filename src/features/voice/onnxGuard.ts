/**
 * @file กันแอปเด้งซ้ำจากโมเดล ONNX (จำเสียง / คำปลุก) — ซ่อมตัวเองแบบ CONCEPT ข้อ 4
 *
 * native crash ใน onnxruntime จับด้วย try/catch ไม่ได้ (แอปปิดทันที · Boss เจอ 2026-10-21 ตอนกดคำปลุก/เปิดหน้าเสียง)
 * → ก่อนโหลดโมเดลจด "กำลังโหลด" ลงเครื่อง · โหลดจบ (สำเร็จหรือ error JS) = ลบ
 * → เปิดแอปครั้งถัดไปยังเจอ "กำลังโหลด" ค้าง = ครั้งก่อนแอปเด้งระหว่างโหลด → ปิดฟีเจอร์ ONNX ไว้ แจ้งบอส
 * บอสกด "ลองอีกครั้ง" ในหน้าตั้งค่าได้ (`resetOnnxGuard`)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ProviderError } from '../../core/http/errors';

export const ONNX_GUARD_KEY = 'atom.onnx.v1.guard';
type GuardState = 'loading' | 'broken';

export const ONNX_BROKEN_MESSAGE =
  'ครั้งก่อนแอปเด้งตอนโหลดโมเดลเสียง (คำปลุก/จำเสียง) — ปิดไว้ก่อนเพื่อไม่ให้เด้งซ้ำ · ลองใหม่ได้ที่ ตั้งค่า › ผู้ช่วยส่วนตัว';

let state: GuardState | null | undefined; // undefined = ยังไม่อ่าน
let active = 0;

async function read(): Promise<GuardState | null> {
  if (state !== undefined) return state;
  try {
    const raw = await AsyncStorage.getItem(ONNX_GUARD_KEY);
    state = raw === 'loading' || raw === 'broken' ? raw : null;
  } catch {
    state = null;
  }
  return state;
}

async function write(next: GuardState | null): Promise<void> {
  state = next;
  try {
    if (next) await AsyncStorage.setItem(ONNX_GUARD_KEY, next);
    else await AsyncStorage.removeItem(ONNX_GUARD_KEY);
  } catch (e) {
    console.error('[onnx-guard] บันทึกสถานะไม่ได้', e);
  }
}

/**
 * เรียกตอนเปิดแอปครั้งเดียว: เจอ "กำลังโหลด" ค้างจากรอบก่อน = แอปเด้งระหว่างโหลด → ทำเครื่องหมายว่าพัง
 * คืน true = เพิ่งตรวจเจอ (ให้ผู้เรียกแจ้งบอส)
 */
export async function checkOnnxGuardOnBoot(): Promise<boolean> {
  if ((await read()) !== 'loading') return false;
  await write('broken');
  return true;
}

export async function isOnnxBroken(): Promise<boolean> {
  return (await read()) === 'broken';
}

/** บอสขอลองใหม่ */
export function resetOnnxGuard(): Promise<void> {
  return write(null);
}

/** ครอบงานที่แตะ onnxruntime (require/install + สร้าง session) */
export async function withOnnxGuard<T>(source: string, fn: () => Promise<T>): Promise<T> {
  if ((await read()) === 'broken')
    throw new ProviderError(source, 'unsupported', ONNX_BROKEN_MESSAGE);
  // นับงานที่โหลดพร้อมกัน (คำปลุก + จำเสียง) — ลบเครื่องหมายเมื่อทุกตัวจบ ไม่งั้นตัวที่เด้งทีหลังจะตรวจไม่เจอ
  if (active++ === 0) await write('loading');
  try {
    return await fn();
  } finally {
    // จบได้ (แม้ error ฝั่ง JS) = ไม่ใช่ native crash
    if (--active === 0) await write(null);
  }
}

/** test เท่านั้น — ล้างค่าที่จำในหน่วยความจำ */
export function __resetOnnxGuardCache(): void {
  state = undefined;
  active = 0;
}
