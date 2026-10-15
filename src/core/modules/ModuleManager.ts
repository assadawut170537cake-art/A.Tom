/**
 * @file ตัวจัดการ module ฝั่งบอส — จำค่าเปิด/ปิด (AsyncStorage) + กฎ dependency + แจ้ง UI เมื่อมีการเปลี่ยน
 *
 * แยกจาก ModuleRegistry: registry = วงจรชีวิตตอนรัน (in-memory) · manager = ค่าที่บอสตั้งและต้องอยู่ข้ามการเปิดแอป
 *
 * - `start()` (src/boot.ts): อ่านค่าที่บันทึกไว้ → ใช้กับ module ที่ลงทะเบียนแล้ว → `initAll()`
 * - `register()`: ลงทะเบียน + ใช้ค่าที่บันทึกไว้ทันที (module ที่โหลดทีหลัง เช่นผ่าน src/modules/loader.ts)
 * - `enable(id)`: เปิด dependency ที่ปิดอยู่ให้ด้วยอัตโนมัติ แล้ว init
 * - `disable(id)`: ปิด module ที่ต้องใช้ตัวนี้ไปด้วย — UI ต้องถามบอสก่อน (ดู {@link ModuleManager.dependentsToDisable})
 * - `subscribe()` + `getSnapshot()` ใช้กับ `useSyncExternalStore`
 *
 * บันทึกไม่สำเร็จ (เช่นที่เต็ม) → สถานะตอนรันยังเปลี่ยนตามที่สั่ง แต่เปิดแอปใหม่จะกลับเป็นค่าเดิม (`saved: false`)
 */

import { readJSON, writeJSON } from '../storage/jsonStorage';
import { isBoolean, isRecord } from '../types/guards';
import { consoleLogger, moduleRegistry, statusOf, type ModuleRegistry } from './ModuleRegistry';
import type { AtomModule, InitReport, ModuleInfo, ModuleLogger, ModuleStatus } from './types';

export const MODULE_FLAGS_KEY = 'atom.modules.v1.enabled';

/** id → เปิดอยู่ไหม (เฉพาะ module ที่บอสเคยกดเปิด/ปิด; ที่ไม่มีใช้ค่า `enabled` ของ module เอง) */
export type ModuleFlags = Record<string, boolean>;

export interface ModuleFlagStore {
  load(): Promise<ModuleFlags>;
  save(flags: Readonly<ModuleFlags>): Promise<void>;
}

/** เก็บใน AsyncStorage key เดียว · ค่าที่ไม่ใช่ boolean ถูกตัดทิ้งทีละ field (เก็บดี ตัดเสีย) */
export const asyncStorageModuleFlags: ModuleFlagStore = {
  async load() {
    const raw = await readJSON(MODULE_FLAGS_KEY, isRecord);
    return Object.fromEntries(Object.entries(raw ?? {}).filter((e): e is [string, boolean] => isBoolean(e[1])));
  },
  save: (flags) => writeJSON(MODULE_FLAGS_KEY, flags),
};

export interface ModuleView extends ModuleInfo {
  status: ModuleStatus;
  /** module ที่ลงทะเบียนอยู่และประกาศว่าต้องใช้ตัวนี้โดยตรง */
  usedBy: string[];
}

export interface ToggleResult {
  /** module ที่ค่าเปิด/ปิดเปลี่ยนจริง (รวมตัวที่สั่ง + ที่เปิด/ปิดตามให้อัตโนมัติ) */
  changed: string[];
  /** false = บันทึกลงเครื่องไม่สำเร็จ (log แล้ว) */
  saved: boolean;
  /** เปิดแล้วแต่ init ล้ม — เหตุผล */
  error?: string | undefined;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ModuleManager {
  private flags: Promise<ModuleFlags> | null = null;
  /** เขียนทีละครั้งตามลำดับ · ต่อด้วย catch เสมอ — เขียนล้มครั้งหนึ่งต้องไม่ทำให้ครั้งถัดไปค้าง */
  private writeChain: Promise<void> = Promise.resolve();
  private started = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: { key: string; views: readonly ModuleView[] } | null = null;

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly store: ModuleFlagStore = asyncStorageModuleFlags,
    private readonly logger: ModuleLogger = consoleLogger
  ) {}

  // ---- lifecycle --------------------------------------------------------------------------------

  /** ตอนเปิดแอป: ใช้ค่าที่บอสบันทึกไว้กับทุก module แล้ว init ตัวที่เปิดอยู่ (ล้มแค่รายงาน ไม่ throw) */
  async start(): Promise<InitReport> {
    for (const { id } of this.registry.list()) await this.applySaved(id);
    const report = await this.registry.initAll();
    this.started = true;
    this.emit();
    return report;
  }

  /** ลงทะเบียน + ใช้ค่าที่บันทึกไว้ · หลัง `start()` แล้วจะ init ให้ทันทีถ้าเปิดอยู่ */
  async register(module: AtomModule): Promise<void> {
    this.registry.register(module);
    await this.applySaved(module.id);
    if (this.started && this.registry.isEnabled(module.id)) {
      await this.registry.ensureReady(module.id).catch((e: unknown) => {
        this.logger.error(`[modules] init "${module.id}" ไม่สำเร็จ`, e);
      });
    }
    this.emit();
  }

  get(id: string): AtomModule | undefined {
    return this.registry.get(id);
  }

  // ---- enable / disable -------------------------------------------------------------------------

  /** module ที่เปิดอยู่และต้องใช้ `id` (ทางตรง/ทางอ้อม) — จะถูกปิดไปด้วยถ้าปิด `id` */
  dependentsToDisable(id: string): string[] {
    return this.registry
      .list()
      .filter((m) => m.id !== id && m.enabled && this.needs(m.id, id))
      .map((m) => m.id);
  }

  /** dependency (ทางตรง/ทางอ้อม) ของ `id` ที่ปิดอยู่ — จะถูกเปิดให้ด้วยถ้าเปิด `id` · ตัวลึกสุดมาก่อน */
  dependenciesToEnable(id: string): string[] {
    const out: string[] = [];
    const seen = new Set([id]);
    const visit = (current: string) => {
      for (const dep of this.registry.get(current)?.dependencies ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        visit(dep);
        if (this.registry.has(dep) && !this.registry.isEnabled(dep)) out.push(dep);
      }
    };
    visit(id);
    return out;
  }

  /** เปิด `id` (+ dependency ที่ปิดอยู่) แล้ว init · init ล้ม → `error` (module ยังเปิดอยู่ กดเริ่มใหม่ได้) */
  async enable(id: string): Promise<ToggleResult> {
    if (!this.registry.has(id)) return { changed: [], saved: true };
    const changed = [...this.dependenciesToEnable(id), id].filter((x) => !this.registry.isEnabled(x));
    for (const x of changed) this.registry.enable(x);
    this.emit();
    const saved = await this.persist(changed, true);
    let error: string | undefined;
    try {
      await this.registry.ensureReady(id);
    } catch (e) {
      error = message(e);
      this.logger.error(`[modules] init "${id}" ไม่สำเร็จ`, e);
    }
    this.emit();
    return { changed, saved, ...(error !== undefined && { error }) };
  }

  /** ปิด `id` และทุก module ที่เปิดอยู่และต้องใช้มัน (dispose ตามลำดับย้อนกลับใน registry) */
  async disable(id: string): Promise<ToggleResult> {
    if (!this.registry.has(id)) return { changed: [], saved: true };
    const changed = [id, ...this.dependentsToDisable(id)].filter((x) => this.registry.isEnabled(x));
    for (const x of changed) await this.registry.disable(x);
    const saved = await this.persist(changed, false);
    this.emit();
    return { changed, saved };
  }

  /**
   * เริ่ม module ใหม่ (เช่นหลัง init ล้ม หรืออยากต่อใหม่) — ไม่เปลี่ยนค่าที่บันทึกไว้
   * module ที่ต้องใช้ตัวนี้และทำงานอยู่ จะถูกหยุดแล้วเริ่มใหม่ตามหลังจากตัวนี้เริ่มสำเร็จ
   * reject เมื่อ module ถูกปิดอยู่หรือ init ยังล้ม
   */
  async reinitialize(id: string): Promise<void> {
    if (!this.registry.isEnabled(id)) throw new Error(`module "${id}" ถูกปิดอยู่`);
    const restart = this.registry
      .list()
      .filter((m) => m.state === 'ready' && m.id !== id && this.needs(m.id, id))
      .map((m) => m.id);
    // registry ไม่มีคำสั่ง "dispose ตัวเดียว" → ปิด (dispose ตัวนี้ + ตัวที่พึ่งมัน) แล้วเปิดกลับทันที
    await this.registry.disable(id);
    this.registry.enable(id);
    this.emit();
    try {
      await this.registry.ensureReady(id);
      for (const dep of restart) {
        await this.registry.ensureReady(dep).catch((e: unknown) => {
          this.logger.error(`[modules] เริ่ม "${dep}" ใหม่ไม่สำเร็จ`, e);
        });
      }
    } finally {
      this.emit();
    }
  }

  // ---- UI store ---------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * รายการ module สำหรับ UI — คำนวณจาก registry ทุกครั้ง (สดเสมอ แม้ state เปลี่ยนจากที่อื่น เช่น
   * PCCommandHandler init เอง) แต่คืน object เดิมถ้าเนื้อหาไม่เปลี่ยน (useSyncExternalStore ต้องการ)
   */
  getSnapshot = (): readonly ModuleView[] => {
    const list = this.registry.list();
    const views = list.map((m) => ({
      ...m,
      status: statusOf(m),
      usedBy: list.filter((other) => other.dependencies.includes(m.id)).map((other) => other.id),
    }));
    const key = JSON.stringify(views);
    if (this.snapshot?.key !== key) this.snapshot = { key, views };
    return this.snapshot.views;
  };

  // ---- internals --------------------------------------------------------------------------------

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** อ่านครั้งเดียวแล้วใช้ cache (ซึ่ง persist อัปเดตตาม) · อ่านไม่ได้ → ใช้ค่าเริ่มต้นของแต่ละ module */
  private savedFlags(): Promise<ModuleFlags> {
    return (this.flags ??= this.store.load().catch((e: unknown): ModuleFlags => {
      this.logger.error('[modules] อ่านค่าเปิด/ปิด module ที่บันทึกไว้ไม่ได้ — ใช้ค่าเริ่มต้นของแต่ละ module', e);
      return {};
    }));
  }

  private async applySaved(id: string): Promise<void> {
    const saved = (await this.savedFlags())[id];
    if (saved === true) this.registry.enable(id);
    else if (saved === false) await this.registry.disable(id);
  }

  private async persist(ids: readonly string[], enabled: boolean): Promise<boolean> {
    if (ids.length === 0) return true;
    const flags = await this.savedFlags();
    for (const id of ids) flags[id] = enabled;
    const snapshot = { ...flags };
    const write = this.writeChain.then(() => this.store.save(snapshot));
    this.writeChain = write.catch(() => {});
    try {
      await write;
      return true;
    } catch (e) {
      this.logger.error('[modules] บันทึกค่าเปิด/ปิด module ไม่สำเร็จ — เปิดแอปใหม่จะกลับเป็นค่าเดิม', e);
      return false;
    }
  }

  /** `id` ต้องใช้ `target` ไหม (ทางตรงหรือผ่าน module อื่น) */
  private needs(id: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const deps = this.registry.get(id)?.dependencies ?? [];
    return deps.some((dep) => dep === target || this.needs(dep, target, seen));
  }
}

/** ตัวเดียวทั้งแอป — boot เรียก `start()` · หน้า ตั้งค่า › Modules ใช้ตัวนี้ */
export const moduleManager = new ModuleManager(moduleRegistry);
