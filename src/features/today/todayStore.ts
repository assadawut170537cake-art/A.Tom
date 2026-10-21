/**
 * @file เช็กลิสต์งานที่ทำอยู่ (แท็บ "วันนี้") — Boss ขอ 2026-10-20
 *
 * เก็บ AsyncStorage `atom.today.v1.tasks` · ไม่ล้างเองตอนข้ามวัน (งานที่ยังไม่เสร็จต้องอยู่ต่อ)
 * งานที่ติ๊กแล้วอยู่ได้จนบอสกด "ล้างที่เสร็จ" · สั่งด้วยแชท/เสียงได้ผ่าน agent "งานวันนี้"
 */

import { create } from 'zustand';

import { readJSON, writeJSON } from '../../core/storage/jsonStorage';
import { isArray, isBoolean, isNumber, isRecord, isString } from '../../core/types/guards';

export const TODAY_TASKS_KEY = 'atom.today.v1.tasks';
export const MAX_TASK_LENGTH = 200;

export interface TodayTask {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  doneAt?: number | undefined;
}

function isTask(v: unknown): v is TodayTask {
  return (
    isRecord(v) &&
    isString(v.id) &&
    isString(v.text) &&
    isBoolean(v.done) &&
    isNumber(v.createdAt) &&
    (v.doneAt === undefined || isNumber(v.doneAt))
  );
}

// field-level guard: งานที่เสียตัดทิ้งเฉพาะตัวนั้น
const isTaskList = (v: unknown): v is unknown[] => isArray(v);

let seq = 0;
const newId = () => `t-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface TodayState {
  tasks: TodayTask[];
  loaded: boolean;
  load: () => Promise<void>;
  /** คืนงานที่เพิ่ม · ข้อความว่าง = null */
  add: (text: string) => TodayTask | null;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clearDone: () => void;
}

export const useTodayStore = create<TodayState>()((set, get) => {
  const save = () => {
    // ก่อนโหลดเสร็จห้ามเขียน — ไม่งั้นงานที่บันทึกไว้ถูกทับด้วยรายการที่มีแค่งานใหม่ (load() บันทึกให้หลัง merge)
    if (!get().loaded) return;
    writeJSON(TODAY_TASKS_KEY, get().tasks).catch((e: unknown) =>
      console.error('[today] บันทึกเช็กลิสต์ไม่สำเร็จ', e),
    );
  };
  const update = (tasks: TodayTask[]) => {
    set({ tasks });
    save();
  };
  return {
    tasks: [],
    loaded: false,
    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await readJSON(TODAY_TASKS_KEY, isTaskList);
        const saved = (raw ?? []).filter(isTask);
        // งานที่เพิ่มก่อนโหลดเสร็จ (สั่งด้วยเสียงตอนเปิดแอป) ต้องไม่หาย
        const ids = new Set(saved.map((t) => t.id));
        const early = get().tasks.filter((t) => !ids.has(t.id));
        set({ tasks: [...saved, ...early], loaded: true });
        if (early.length) save();
      } catch (e) {
        console.error('[today] โหลดเช็กลิสต์ไม่สำเร็จ', e);
        set({ loaded: true });
      }
    },
    add: (text) => {
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TASK_LENGTH);
      if (!clean) return null;
      const task: TodayTask = { id: newId(), text: clean, done: false, createdAt: Date.now() };
      update([...get().tasks, task]);
      return task;
    },
    toggle: (id) =>
      update(
        get().tasks.map((t) =>
          t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() } : t,
        ),
      ),
    remove: (id) => update(get().tasks.filter((t) => t.id !== id)),
    clearDone: () => update(get().tasks.filter((t) => !t.done)),
  };
});

/** หางานจากคำพูด ("ติ๊กงาน ซื้อของ") — ตรงทั้งคำก่อน แล้วค่อยมีคำนั้นอยู่ · ไม่เจอ = undefined */
export function findTask(tasks: TodayTask[], query: string): TodayTask | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    tasks.find((t) => t.text.toLowerCase() === q) ??
    tasks.find((t) => !t.done && t.text.toLowerCase().includes(q)) ??
    tasks.find((t) => t.text.toLowerCase().includes(q))
  );
}

const sameDay = (a: number, b: Date) => {
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
};
export const isToday = (at: number, now = new Date()) => sameDay(at, now);
