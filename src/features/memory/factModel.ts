/**
 * @file ข้อมูลและกติกาของ Memory UI (ไม่มี React) — โหลด/กรอง/ตรวจ fact ให้หน้าจอใช้
 */

import {
  ALL_MEMORY_TARGETS,
  MEMORY_KEY_PATTERN,
  scopeSegment,
  type MemoryFact,
  type MemorySource,
  type MemoryStore,
  type MemoryTarget,
} from '../../core/memory/types';
import { PERSONAS } from '../jarvis/constants';
import { MAX_FACT_LENGTH } from '../router/handlers/ChatHandler';

/** ค่ายาวสุดที่บันทึกได้ = ที่ ChatHandler ส่งเข้า prompt จริง (ยาวกว่านี้ก็ถูกตัดทิ้งอยู่ดี) */
export const MAX_VALUE_LENGTH = MAX_FACT_LENGTH;

/** fact หนึ่งตัว + ขอบเขตที่มันอยู่ (MemoryFact เองไม่รู้ว่าอยู่ global หรือ persona ไหน) */
export interface ScopedFact {
  target: MemoryTarget;
  fact: MemoryFact;
}

export type FactFilter = 'all' | 'global' | 'persona';

export interface FactDraft {
  key: string;
  value: string;
  target: MemoryTarget;
}

/** id ที่ไม่ซ้ำทั้งแอป (key เดียวกันอยู่ได้หลายขอบเขต) */
export const slotOf = (target: MemoryTarget, key: string) => `${scopeSegment(target)}.${key}`;

/** ทุก fact ทุกขอบเขต — แก้ไขล่าสุดขึ้นก่อน */
export async function loadAllFacts(memory: MemoryStore): Promise<ScopedFact[]> {
  const lists = await Promise.all(
    ALL_MEMORY_TARGETS.map(async (target) => (await memory.list(target)).map((fact) => ({ target, fact })))
  );
  return lists.flat().sort((a, b) => b.fact.updatedAt - a.fact.updatedAt);
}

export function filterFacts(facts: readonly ScopedFact[], filter: FactFilter): ScopedFact[] {
  return filter === 'all' ? [...facts] : facts.filter((f) => f.target.scope === filter);
}

/** ข้อความ error ภาษาไทยต่อช่อง (ว่าง = ผ่าน) */
export function validateDraft({ key, value }: Pick<FactDraft, 'key' | 'value'>): { key?: string; value?: string } {
  const errors: { key?: string; value?: string } = {};
  if (!key.trim()) errors.key = 'ใส่ชื่อ key ก่อน';
  else if (!MEMORY_KEY_PATTERN.test(key.trim())) {
    errors.key = 'key ใช้ได้เฉพาะ A-Z a-z 0-9 _ - (ไม่มีเว้นวรรค ไม่เกิน 64 ตัว)';
  }
  if (!value.trim()) errors.value = 'ใส่สิ่งที่ต้องการให้จำ';
  else if (value.trim().length > MAX_VALUE_LENGTH) errors.value = `ยาวได้ไม่เกิน ${MAX_VALUE_LENGTH} ตัวอักษร`;
  return errors;
}

export function sourceLabel(source: MemorySource): string {
  switch (source) {
    case 'user':
      return 'บอสเพิ่มเอง';
    case 'assistant':
      return 'ผู้ช่วยจำ';
    case 'system':
      return 'ระบบ';
    default:
      return `module ${source.slice('module:'.length)}`;
  }
}

export function targetLabel(target: MemoryTarget): { label: string; color: string | undefined } {
  if (target.scope === 'global') return { label: 'Global', color: undefined };
  const persona = PERSONAS[target.persona];
  return { label: persona.name, color: persona.color };
}
