/**
 * @file Inbox ของมือถือ — รับงานที่ Mark 55 ส่งมา (PC → มือถือ) ผ่าน Memory Bus (mark55/sql/003_mobile_inbox.sql)
 *
 * poll `mobile_claim_inbox` ทุก {@link INBOX_INTERVAL_MS} ตอนแอปทำงาน (รวมตอนโหมดเฝ้าอยู่เบื้องหลัง —
 * process ยังอยู่ด้วย Foreground Service ของการอัดเสียง) · ยังไม่ตั้งค่า Mark 55 Bus = ไม่เรียกอะไรเลย
 *
 * | instruction  | payload                               | ทำอะไร                                  |
 * |--------------|---------------------------------------|-----------------------------------------|
 * | `NOTIFY`      | `{ text, speak? }`                    | แสดงในแชท (+ พูด)                         |
 * | `DEVICE_TOOL` | `{ tool: "device.*", text?, args? }`  | DeviceControlBridge (ปุ่มเสี่ยงรอบอสยืนยัน) |
 *
 * ผลทุกงานส่งกลับด้วย `mobile_finish_task` · handler ล้ม = FAILED (ไม่ throw ออกไปทำ loop ตาย)
 * `args.confirmed` จาก PC ถูกตัดทิ้ง — การยืนยันปุ่มเสี่ยงต้องมาจากบอสบนมือถือเท่านั้น (เหมือน AgentHarness)
 * ไม่มี push notification จริง (ต้องใช้ FCM + dependency ใหม่) — แอปถูกปิด = ได้รับเมื่อเปิดใหม่ (ค้างเกิน 1 วัน = หมดอายุ)
 */

import type { AgentToolCall, AgentToolResult } from '../../core/agent/types';
import { redactSecrets } from '../../core/http/errors';
import { isBoolean, isRecord, isString } from '../../core/types/guards';
import type { InboxTask } from './MemoryBusClient';
import type { PcBridgeConfig, PcBridgeSettingsStore } from './settings';

export const INBOX_INTERVAL_MS = 15_000;
/** ข้อความยาวกว่านี้ตัดทิ้ง (แชท + TTS) */
export const MAX_NOTIFY_LENGTH = 1000;

export interface InboxClient {
  claimInbox(limit?: number): Promise<InboxTask[]>;
  finishTask(taskId: string, ok: boolean, result: Record<string, unknown>): Promise<boolean>;
}

export interface InboxHandlers {
  /** แสดงข้อความจาก PC · `speak` = ขอให้พูดด้วย */
  notify(text: string, speak: boolean): void | Promise<void>;
  deviceTool(call: AgentToolCall): Promise<AgentToolResult>;
}

export interface InboxTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PcInboxDeps {
  settings: Pick<PcBridgeSettingsStore, 'load'>;
  createClient: (config: PcBridgeConfig) => InboxClient;
  handlers: InboxHandlers;
  intervalMs?: number;
  timers?: InboxTimers;
}

const REAL_TIMERS: InboxTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  // handle มาจาก setInterval ด้านบนเสมอ — cast เพื่อไม่ผูก interface กับชนิด timer ของ Node/RN
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

interface Outcome {
  ok: boolean;
  result: Record<string, unknown>;
}

const fail = (error: string): Outcome => ({ ok: false, result: { error } });

export class PcInbox {
  private timer: unknown = null;
  /** poll รอบก่อนยังไม่จบ → ข้ามรอบนี้ (เครือข่ายช้ากว่า interval) */
  private polling = false;
  private readonly timers: InboxTimers;

  constructor(private readonly deps: PcInboxDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** เริ่ม poll (ดึงทันทีหนึ่งรอบ) · เรียกซ้ำได้ */
  start(): void {
    if (this.timer !== null) return;
    this.timer = this.timers.setInterval(
      () => void this.pollOnce(),
      this.deps.intervalMs ?? INBOX_INTERVAL_MS,
    );
    void this.pollOnce();
  }

  stop(): void {
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** ดึง + ทำ + ส่งผล 1 รอบ · คืนจำนวนงานที่ทำ · ไม่ throw */
  async pollOnce(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      const config = await this.deps.settings.load();
      if (!config) return 0;
      const client = this.deps.createClient(config);
      const tasks = await client.claimInbox();
      for (const task of tasks) {
        const outcome = await this.handle(task);
        try {
          await client.finishTask(task.taskId, outcome.ok, outcome.result);
        } catch (e) {
          // ทำไปแล้ว แค่ส่งผลไม่ได้ — งานค้าง IN_PROGRESS ไม่ถูกรับซ้ำ (ดีกว่าแจ้งเตือนซ้ำ)
          console.error(`[pc-bridge] ส่งผลงาน ${task.taskId} กลับไม่ได้`, e);
        }
      }
      return tasks.length;
    } catch (e) {
      console.error('[pc-bridge] ดึง inbox จาก Mark 55 ไม่ได้ — ลองใหม่รอบหน้า', e);
      return 0;
    } finally {
      this.polling = false;
    }
  }

  private async handle(task: InboxTask): Promise<Outcome> {
    try {
      switch (task.instruction) {
        case 'NOTIFY':
          return await this.notify(task.payload);
        case 'DEVICE_TOOL':
          return await this.deviceTool(task.payload);
        default:
          return fail(`มือถือไม่รู้จัก instruction "${task.instruction}"`);
      }
    } catch (e) {
      return fail(redactSecrets(e instanceof Error ? e.message : String(e)));
    }
  }

  private async notify(payload: Record<string, unknown>): Promise<Outcome> {
    const text = isString(payload.text) ? payload.text.trim().slice(0, MAX_NOTIFY_LENGTH) : '';
    if (!text) return fail('payload.text ว่าง');
    const speak = isBoolean(payload.speak) ? payload.speak : true;
    await this.deps.handlers.notify(text, speak);
    return { ok: true, result: { shown: true } };
  }

  private async deviceTool(payload: Record<string, unknown>): Promise<Outcome> {
    const tool = isString(payload.tool) ? payload.tool : '';
    // inbox สั่งได้เฉพาะ tool ของอุปกรณ์ — ไม่ใช่ module / MCP / skill
    if (!tool.startsWith('device.'))
      return fail(`สั่ง tool "${tool}" จาก PC ไม่ได้ (รับเฉพาะ device.*)`);
    let args: Record<string, unknown> | undefined;
    if (isRecord(payload.args)) {
      const { confirmed: _confirmed, ...rest } = payload.args;
      if (Object.keys(rest).length) args = rest;
    }
    const call: AgentToolCall = {
      tool,
      text: isString(payload.text) ? payload.text : '',
      ...(args && { args }),
    };
    const result = await this.deps.handlers.deviceTool(call);
    return {
      ok: result.ok,
      result: {
        output: result.output,
        ...(result.needsConfirmation && { needsConfirmation: true }),
      },
    };
  }
}
