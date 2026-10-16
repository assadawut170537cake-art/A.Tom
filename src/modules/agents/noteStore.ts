/**
 * @file ที่เก็บโน้ตของ sample agent "โน้ต" — AsyncStorage `atom.agents.v1.notes` (ใหม่สุดก่อน)
 *
 * มี subscribe() ให้หน้าจอโน้ตที่เปิดค้างอยู่ใน Agent Panel อัปเดตทันทีเมื่อสั่ง "จดบันทึกว่า…" เพิ่ม
 */

import { readJSON, writeJSON } from '../../core/storage/jsonStorage';
import { isNumber, isRecord, isString } from '../../core/types/guards';

export const NOTES_STORAGE_KEY = 'atom.agents.v1.notes';
/** ยาวเกินนี้น่าจะเป็นการวางข้อความผิดที่ — บอกให้ย่อแทนการเก็บเงียบ ๆ */
export const MAX_NOTE_LENGTH = 500;
/** เก็บแค่นี้ ตัวเก่าสุดหลุดก่อน (กัน AsyncStorage โตไม่สิ้นสุด) */
export const MAX_NOTES = 200;

export interface Note {
  id: string;
  text: string;
  createdAt: number;
}

const isNote = (v: unknown): v is Note => isRecord(v) && isString(v.id) && isString(v.text) && isNumber(v.createdAt);
const isNoteList = (v: unknown): v is unknown[] => Array.isArray(v);

type Listener = (notes: readonly Note[]) => void;

export class NoteStore {
  private notes: Note[] | null = null;
  private readonly listeners = new Set<Listener>();
  /** เขียนทีละครั้งตามลำดับ — เขียนล้มต้องไม่ทำให้คิวค้าง */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly key: string = NOTES_STORAGE_KEY) {}

  async list(): Promise<readonly Note[]> {
    if (!this.notes) {
      const raw = (await readJSON(this.key, isNoteList)) ?? [];
      // field-level guard: เก็บตัวที่ดี ตัดตัวที่เสีย
      this.notes ??= raw.filter(isNote);
    }
    return this.notes;
  }

  /** throw (ข้อความไทย) เมื่อว่างหรือยาวเกิน */
  async add(text: string, now: number = Date.now()): Promise<Note> {
    const clean = text.trim();
    if (!clean) throw new Error('ยังไม่ได้บอกว่าจะจดอะไร — ลองพิมพ์ "จดบันทึกว่า พรุ่งนี้ประชุม 9 โมง"');
    if (clean.length > MAX_NOTE_LENGTH) {
      throw new Error(`โน้ตยาวเกิน ${MAX_NOTE_LENGTH} ตัวอักษร — ช่วยย่อให้สั้นลงหน่อยครับ`);
    }
    const note: Note = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text: clean, createdAt: now };
    const next = [note, ...(await this.list())].slice(0, MAX_NOTES);
    await this.save(next);
    return note;
  }

  async remove(id: string): Promise<void> {
    const current = await this.list();
    const next = current.filter((n) => n.id !== id);
    if (next.length !== current.length) await this.save(next);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private save(next: Note[]): Promise<void> {
    this.notes = next;
    for (const listener of this.listeners) listener(next);
    const run = this.writeChain.then(() => writeJSON(this.key, next));
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}

export const noteStore = new NoteStore();
