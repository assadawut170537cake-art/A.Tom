/**
 * @file Module System — สัญญาของ module ที่เสียบเพิ่มเข้า A.T.O.M. ได้ (Phase 4 scaffold)
 *
 * module = ความสามารถที่แยกเป็นก้อน มีวงจรชีวิตชัดเจน (`init` → ใช้งาน → `dispose`)
 * และประกาศ module อื่นที่ต้องพึ่งได้ (`dependencies`) — ModuleRegistry จะ init ตามลำดับ dependency
 *
 * ตัวอย่างแรกที่วางแผนไว้: `pc-bridge` (สั่งงานคอมพิวเตอร์) ซึ่ง PCCommandHandler เรียกผ่าน
 * {@link CommandModule.execute}
 *
 * @see ../../../docs/DECISIONS.md — ADR-011
 */

import type { MemoryStore } from '../memory/types';

export interface ModuleLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

/** What every module receives in init(): shared services, never feature internals. */
export interface ModuleContext {
  memory: MemoryStore;
  logger: ModuleLogger;
}

export interface AtomModule {
  /** Unique, stable id, e.g. 'pc-bridge'. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** คำอธิบายสั้น ๆ แสดงในหน้า ตั้งค่า › Modules */
  readonly description?: string | undefined;
  /** Initial state on register(); ModuleRegistry.enable()/disable() change it afterwards. */
  readonly enabled: boolean;
  /** Ids of modules that must be initialised first. */
  readonly dependencies?: readonly string[] | undefined;
  init(context: ModuleContext): Promise<void> | void;
  dispose(): Promise<void> | void;
}

export interface ModuleCommand {
  /** The user's original text. */
  text: string;
  action?: string | undefined;
  target?: string | undefined;
}

export interface ModuleCommandResult {
  /** Text to show (and speak) as the assistant's reply. */
  reply: string;
}

/** A module that can carry out commands (e.g. the PC bridge). */
export interface CommandModule extends AtomModule {
  execute(command: ModuleCommand): Promise<ModuleCommandResult>;
}

export function isCommandModule(module: AtomModule): module is CommandModule {
  return 'execute' in module && typeof module.execute === 'function';
}

export type ModuleState = 'idle' | 'initializing' | 'ready' | 'failed';

/**
 * สถานะที่บอสเห็นใน UI (ย่อจาก enabled + state):
 * - `enabled` = เปิดและ init สำเร็จ (ทำงานอยู่)
 * - `disabled` = ปิดอยู่ (ไม่ว่า state จะเป็นอะไร)
 * - `error` = เปิดอยู่แต่ init ล้ม
 * - `not-initialized` = เปิดอยู่แต่ยังไม่ได้ init (หรือกำลัง init)
 */
export type ModuleStatus = 'enabled' | 'disabled' | 'error' | 'not-initialized';

export interface ModuleInfo {
  id: string;
  name: string;
  description?: string | undefined;
  enabled: boolean;
  state: ModuleState;
  dependencies: readonly string[];
  /** Why the last init failed. */
  error?: string | undefined;
}

export interface InitReport {
  /** Modules ready after the call, in init order. */
  ready: string[];
  failed: { id: string; reason: string }[];
}
