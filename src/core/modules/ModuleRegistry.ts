/**
 * @file ทะเบียน module + ตัวจัดการวงจรชีวิต (register → enable → init → dispose)
 *
 * - `initAll()` init ทุก module ที่เปิดอยู่ **ตามลำดับ dependency** (dependency ก่อนเสมอ)
 * - `disposeAll()` dispose **ย้อนลำดับ** ที่ init จริง
 * - module ที่ init ล้ม, dependency หาย/ถูกปิด หรือ dependency วนกัน → สถานะ `failed`
 *   พร้อมเหตุผล ไม่ทำให้ module อื่นหรือแอปล้มตาม (`console.error` ผ่าน logger)
 * - `disable()` dispose module นั้นและทุก module ที่พึ่งมันอยู่
 *
 * `initAll()` ถูกเรียกตอนเปิดแอปใน src/boot.ts · TODO(phase-4.5): หน้าตั้งค่าเปิด/ปิด module
 */

import { localMemory } from '../memory/LocalMemoryAdapter';
import type { AtomModule, InitReport, ModuleContext, ModuleInfo, ModuleLogger, ModuleState } from './types';

interface Entry {
  module: AtomModule;
  enabled: boolean;
  state: ModuleState;
  error?: string | undefined;
  /** In-flight init, so concurrent callers share one init() call. */
  pending?: Promise<void> | undefined;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ModuleRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Ids in the order their init() succeeded; disposed in reverse. */
  private readonly initOrder: string[] = [];

  constructor(private readonly context: ModuleContext) {}

  register(module: AtomModule): void {
    if (this.entries.has(module.id)) {
      throw new Error(`[modules] module "${module.id}" ลงทะเบียนไว้แล้ว`);
    }
    this.entries.set(module.id, { module, enabled: module.enabled, state: 'idle' });
  }

  /** Disposes the module (and anything ready that depends on it) first. */
  async unregister(id: string): Promise<boolean> {
    if (!this.entries.has(id)) return false;
    await this.disposeWithDependents(id);
    this.entries.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): AtomModule | undefined {
    return this.entries.get(id)?.module;
  }

  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  /** Allows the module to be initialised (by initAll / ensureReady). */
  enable(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = true;
    return true;
  }

  /** Stops the module and everything that depends on it. */
  async disable(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = false;
    await this.disposeWithDependents(id);
    return true;
  }

  /** In registration order. */
  list(): ModuleInfo[] {
    return [...this.entries.values()].map(({ module, enabled, state, error }) => ({
      id: module.id,
      name: module.name,
      enabled,
      state,
      dependencies: module.dependencies ?? [],
      ...(error !== undefined && { error }),
    }));
  }

  /** Initialise one module (and its dependencies) if needed; rejects with the reason it can't. */
  ensureReady(id: string): Promise<void> {
    return this.initOne(id, []);
  }

  /** Initialise every enabled module in dependency order; failures are reported, not thrown. */
  async initAll(): Promise<InitReport> {
    const failed: InitReport['failed'] = [];
    for (const [id, entry] of this.entries) {
      if (!entry.enabled) continue;
      try {
        await this.initOne(id, []);
      } catch (e) {
        failed.push({ id, reason: message(e) });
        this.context.logger.error(`[modules] init "${id}" ไม่สำเร็จ`, e);
      }
    }
    return { ready: [...this.initOrder], failed };
  }

  /** Dispose every ready module in reverse init order; errors are logged, never thrown. */
  async disposeAll(): Promise<void> {
    for (const id of [...this.initOrder].reverse()) await this.disposeOne(id);
  }

  // ---- internals ------------------------------------------------------------------------------

  private async initOne(id: string, path: readonly string[]): Promise<void> {
    if (path.includes(id)) {
      throw new Error(`dependency วนกัน: ${[...path, id].join(' → ')}`);
    }
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`ไม่พบ module "${id}"`);
    if (!entry.enabled) throw new Error(`module "${id}" ถูกปิดอยู่`);
    if (entry.state === 'ready') return;
    if (entry.pending) return entry.pending;

    entry.pending = (async () => {
      entry.state = 'initializing';
      try {
        for (const dep of entry.module.dependencies ?? []) {
          try {
            await this.initOne(dep, [...path, id]);
          } catch (e) {
            throw new Error(`"${id}" ต้องใช้ "${dep}": ${message(e)}`);
          }
        }
        await entry.module.init(this.context);
        entry.state = 'ready';
        entry.error = undefined;
        this.initOrder.push(id);
      } catch (e) {
        entry.state = 'failed';
        entry.error = message(e);
        throw e;
      } finally {
        entry.pending = undefined;
      }
    })();
    return entry.pending;
  }

  private async disposeWithDependents(id: string): Promise<void> {
    for (const other of [...this.initOrder].reverse()) {
      if (other === id || this.dependsOn(other, id)) await this.disposeOne(other);
    }
  }

  private async disposeOne(id: string): Promise<void> {
    const entry = this.entries.get(id);
    const index = this.initOrder.indexOf(id);
    if (index !== -1) this.initOrder.splice(index, 1);
    if (!entry || entry.state !== 'ready') return;
    entry.state = 'idle';
    try {
      await entry.module.dispose();
    } catch (e) {
      this.context.logger.error(`[modules] dispose "${id}" ไม่สำเร็จ`, e);
    }
  }

  /** True when `id` needs `target`, directly or through other modules. */
  private dependsOn(id: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const deps = this.entries.get(id)?.module.dependencies ?? [];
    return deps.some((dep) => dep === target || this.dependsOn(dep, target, seen));
  }
}

/** info is silent (project rule: console.error only); errors go to console.error. */
export const consoleLogger: ModuleLogger = {
  info: () => {},
  error: (msg, error) => console.error(msg, error),
};

/** App-wide registry (initAll ตอน boot). TODO(phase-4.5): ลงทะเบียน module จริงผ่าน src/modules/loader.ts */
export const moduleRegistry = new ModuleRegistry({ memory: localMemory, logger: consoleLogger });
