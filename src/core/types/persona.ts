/**
 * @file Persona — ผู้ช่วย 4 ตัวของ A.T.O.M. ในระดับข้อมูลล้วน (ไม่มีชื่อ/สี/UI)
 *
 * อยู่ใน core เพราะ storage, memory, router และ voice ต่างก็ต้องใช้ — ถ้าอยู่ใน features/jarvis
 * core จะต้อง import ย้อนไปหา feature (ผิดทิศทาง dependency)
 * ชื่อ สี คำทักทาย ยังอยู่ที่ `features/jarvis/constants` เพราะเป็นเรื่องของ UI
 */

import { isOneOf } from './guards';

/** 1 อะตอม · 2 จาร์วิส · 3 ไฟรเดย์ · 4 อัลตรอน */
export const PERSONA_IDS = [1, 2, 3, 4] as const;

export type Persona = (typeof PERSONA_IDS)[number];

export const DEFAULT_PERSONA: Persona = 1;

export const isPersona = (value: unknown): value is Persona => isOneOf(PERSONA_IDS, value);
