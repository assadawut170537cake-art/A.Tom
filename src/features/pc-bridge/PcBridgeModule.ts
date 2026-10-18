/**
 * @file Module `pc-bridge` — สั่งงาน Mark 55 จากแชทผ่าน Memory Bus บน Supabase (Phase 4.5.5.3)
 *
 * PCCommandHandler (intent `pc_command`) → `execute()`:
 * 1. ยังไม่ตั้งค่า → บอกให้ไปที่ ตั้งค่า › Mark 55 Bus
 * 2. ข้อความ → instruction (commands.ts) · ไม่รู้จัก → บอกว่าสั่งอะไรได้บ้าง
 * 3. `mobile_submit_task` → รอผลสั้น ๆ ด้วย `mobile_get_task`
 *    เสร็จทัน → ตอบผล · ไม่ทัน → ตอบว่าส่งแล้ว (Mark 55 อาจปิดอยู่ — งานรอในคิวจนกว่าจะเปิด)
 *
 * error ที่รู้สาเหตุ (token ผิด, ส่งถี่, ออฟไลน์) ตอบเป็นข้อความไทยพร้อมวิธีแก้ ไม่ throw —
 * ถ้า throw ProviderError ออกไป แชทจะแนะนำให้ไปเช็ก "ตั้งค่า › AI" ซึ่งผิดที่
 */

import { ProviderError } from '../../core/http/errors';
import type { CommandModule, ModuleCommand, ModuleCommandResult } from '../../core/modules/types';
import { describeResult, resolveCommand, unsupportedReply } from './commands';
import { MemoryBusClient, type BusTask } from './MemoryBusClient';
import { pcBridgeSettings, type PcBridgeConfig, type PcBridgeSettingsStore } from './settings';

export const PC_BRIDGE_ID = 'pc-bridge';

export const NOT_CONFIGURED_REPLY = 'ยังไม่ได้เชื่อม Mark 55 ครับ — ตั้งค่าได้ที่ ตั้งค่า › Mark 55 Bus';

export interface BusClient {
  submitTask(instruction: string, payload: Record<string, unknown>): Promise<string>;
  getTask(taskId: string): Promise<BusTask | null>;
}

export interface PcBridgeDeps {
  settings: Pick<PcBridgeSettingsStore, 'load'>;
  createClient: (config: PcBridgeConfig) => BusClient;
  sleep: (ms: number) => Promise<void>;
  /** รอผลนานสุดเท่านี้ก่อนตอบว่า "ส่งแล้ว" */
  waitMs: number;
  pollMs: number;
}

const DEFAULT_DEPS: PcBridgeDeps = {
  settings: pcBridgeSettings,
  createClient: (config) => new MemoryBusClient(config),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitMs: 8_000,
  pollMs: 1_000,
};

/** รหัสงานแบบสั้นให้ Boss อ้างถึงได้ (8 ตัวแรกของ UUID) */
export const shortId = (taskId: string) => taskId.slice(0, 8);

export class PcBridgeModule implements CommandModule {
  readonly id = PC_BRIDGE_ID;
  readonly name = 'Mark 55 Bus';
  readonly description = 'สั่งงาน Mark 55 จากแชท (เช็กเครื่อง · บิลด์) ผ่าน Supabase';
  readonly enabled = true;
  private readonly deps: PcBridgeDeps;

  constructor(deps: Partial<PcBridgeDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  init(): void {}

  dispose(): void {}

  async execute(command: ModuleCommand): Promise<ModuleCommandResult> {
    const config = await this.deps.settings.load();
    if (!config) return { reply: NOT_CONFIGURED_REPLY };

    const resolved = resolveCommand(command);
    if (!resolved) return { reply: unsupportedReply() };
    const { spec, payload } = resolved;

    const client = this.deps.createClient(config);
    let taskId: string;
    try {
      taskId = await client.submitTask(spec.instruction, payload);
    } catch (e) {
      return { reply: `ส่งงาน "${spec.label}" ไม่สำเร็จ — ${failureAdvice(e)}` };
    }

    const sent = `ส่งงาน "${spec.label}" ให้ Mark 55 แล้ว (รหัส ${shortId(taskId)})`;
    let last: BusTask | null = null;
    try {
      for (let waited = 0; waited < this.deps.waitMs; waited += this.deps.pollMs) {
        await this.deps.sleep(this.deps.pollMs);
        last = await client.getTask(taskId);
        if (last && (last.status === 'COMPLETED' || last.status === 'FAILED')) {
          return { reply: describeResult(last, spec.label) };
        }
      }
    } catch (e) {
      // งานส่งไปแล้ว — แค่อ่านผลไม่ได้ ไม่ควรบอกว่าล้ม
      return { reply: `${sent} แต่อ่านผลไม่ได้ — ${failureAdvice(e)}` };
    }
    if (last?.status === 'IN_PROGRESS') return { reply: `${sent} · Mark 55 กำลังทำอยู่ครับ` };
    return { reply: `${sent} · Mark 55 ยังไม่รับงาน (อาจปิดเครื่องอยู่) — เปิดเมื่อไหร่จะทำต่อให้เองครับ` };
  }
}

/** สาเหตุ + วิธีแก้ (ไทย) จาก error ของ RPC */
export function failureAdvice(e: unknown): string {
  if (!(e instanceof ProviderError)) return e instanceof Error ? e.message : String(e);
  switch (e.kind) {
    case 'auth':
      return 'token เครื่องหรือ anon key ไม่ถูกต้อง (หรือ token ถูกยกเลิก) — ตรวจได้ที่ ตั้งค่า › Mark 55 Bus';
    case 'rate_limit':
      return 'ส่งงานถี่เกินไป รอสักครู่แล้วลองใหม่';
    case 'network':
    case 'timeout':
      return 'เชื่อมต่อ Supabase ไม่ได้ — เช็กอินเทอร์เน็ต';
    case 'server':
      return 'Supabase ขัดข้อง ลองใหม่อีกครั้ง';
    default:
      return e.message.replace(/^\[[^\]]+\]\s*/, '');
  }
}

export default new PcBridgeModule();
