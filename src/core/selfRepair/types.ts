/**
 * @file ชนิดข้อมูลของระบบ "ซ่อมตัวเอง" (CONCEPT ข้อ 4) — ขอบเขตปัจจุบัน: การตั้งค่า/ข้อมูลใน AsyncStorage
 * (ยังไม่แตะโค้ดแอป/OTA ซึ่งเป็นด่านรอบอสอนุมัติ)
 */

import { isArray, isNumber, isOneOf, isRecord, isString, type Guard } from '../types/guards';

/** สำเนาค่าของ key ชุดหนึ่งไว้ย้อนกลับ — `data[key] = null` = ตอน snapshot key นั้นไม่มีอยู่ (ย้อน = ลบ key) */
export interface Snapshot {
  id: string;
  /** อธิบายว่าถ่ายไว้ตอนจะซ่อมอะไร */
  label: string;
  /** epoch ms */
  at: number;
  keys: string[];
  data: Record<string, string | null>;
}

export interface RepairAttempt {
  /** ปัญหาที่พยายามซ่อม (ใช้จับคู่กับวิธีที่เคยได้ผล) */
  problem: string;
  /** ชื่อวิธีที่ลอง */
  method: string;
  outcome: 'success' | 'fail';
  at: number;
}

const isStringOrNull = (v: unknown): v is string | null => v === null || isString(v);

export const isSnapshot: Guard<Snapshot> = (v): v is Snapshot =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.label) &&
  isNumber(v.at) &&
  isArray(v.keys) &&
  v.keys.every(isString) &&
  isRecord(v.data) &&
  Object.values(v.data).every(isStringOrNull);

export const isSnapshotArray: Guard<Snapshot[]> = (v): v is Snapshot[] =>
  isArray(v) && v.every(isSnapshot);

export const isRepairAttempt: Guard<RepairAttempt> = (v): v is RepairAttempt =>
  isRecord(v) &&
  isString(v.problem) &&
  isString(v.method) &&
  isOneOf(['success', 'fail'] as const, v.outcome) &&
  isNumber(v.at);

export const isRepairLog: Guard<RepairAttempt[]> = (v): v is RepairAttempt[] =>
  isArray(v) && v.every(isRepairAttempt);
