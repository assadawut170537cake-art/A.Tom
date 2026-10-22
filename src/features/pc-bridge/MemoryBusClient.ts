/**
 * @file เรียก RPC ของ Memory Bus บน Supabase ด้วย fetch ตรง (ADR-001 — ไม่ใช้ supabase-js)
 *
 * แอปเรียกได้แค่ RPC เหล่านี้ — ตาราง memory_tasks ปิดสำหรับ anon key
 * - `mobile_submit_task` → task_id                      (002_mobile_rpc.sql — มือถือสั่ง PC)
 * - `mobile_get_task`    → สถานะ/ผล (เฉพาะงานที่เครื่องนี้ส่ง · ไม่มี = null)
 * - `mobile_claim_inbox` → งานที่ PC ส่งหาเครื่องนี้     (003_mobile_inbox.sql — PC สั่งมือถือ)
 * - `mobile_finish_task` → ส่งผลกลับ
 *
 * error ทุกแบบเป็น ProviderError จาก core/http (403 = token ผิด/ถูกยกเลิก · 429 = ส่งถี่เกิน · 400 = ข้อมูลผิด)
 */

import { ProviderError } from '../../core/http/errors';
import { requestJson } from '../../core/http/request';
import { isOneOf, isRecord, isString } from '../../core/types/guards';
import type { PcBridgeConfig } from './settings';

export const PC_BRIDGE_PROVIDER_ID = 'pc-bridge';

/** Mark 55 ปิดอยู่ก็ไม่ควรทำให้แชทค้างนาน */
const RPC_TIMEOUT_MS = 10_000;

export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface BusTask {
  taskId: string;
  instruction: string;
  status: TaskStatus;
  result: Record<string, unknown>;
  claimedBy: string | null;
}

/** ค่าที่ RPC คืนมาเป็นข้อมูลภายนอก — ตรวจทีละ field แทนการ cast */
export function parseTask(value: unknown): BusTask | null {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value.task_id) || !isOneOf(TASK_STATUSES, value.status)) {
    throw new ProviderError(
      PC_BRIDGE_PROVIDER_ID,
      'invalid_response',
      'ข้อมูลงานจาก Supabase ไม่ครบ',
    );
  }
  return {
    taskId: value.task_id,
    instruction: isString(value.instruction) ? value.instruction : '',
    status: value.status,
    result: isRecord(value.result) ? value.result : {},
    claimedBy: isString(value.claimed_by) ? value.claimed_by : null,
  };
}

/** งานที่ Mark 55 ส่งหามือถือ (target = MOBILE:<device> / MOBILE_ALL) */
export interface InboxTask {
  taskId: string;
  instruction: string;
  sender: string;
  payload: Record<string, unknown>;
}

/** รายการจาก mobile_claim_inbox — แถวที่ไม่ครบถูกข้าม (log) แทนที่จะทิ้งทั้งชุด */
export function parseInbox(value: unknown): InboxTask[] {
  if (!Array.isArray(value)) {
    throw new ProviderError(
      PC_BRIDGE_PROVIDER_ID,
      'invalid_response',
      'inbox จาก Supabase ไม่ใช่รายการ',
    );
  }
  return value.flatMap((row: unknown): InboxTask[] => {
    if (!isRecord(row) || !isString(row.task_id) || !isString(row.instruction)) {
      console.error('[pc-bridge] ข้ามงานใน inbox ที่ข้อมูลไม่ครบ', row);
      return [];
    }
    return [
      {
        taskId: row.task_id,
        instruction: row.instruction,
        sender: isString(row.sender) ? row.sender : '',
        payload: isRecord(row.payload) ? row.payload : {},
      },
    ];
  });
}

export class MemoryBusClient {
  constructor(private readonly config: PcBridgeConfig) {}

  async submitTask(
    instruction: string,
    payload: Record<string, unknown>,
    target?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      p_token: this.config.token,
      p_instruction: instruction,
      p_payload: payload,
    };
    if (target) body.p_target = target;
    const id = await this.rpc('mobile_submit_task', body);
    if (!isString(id)) {
      throw new ProviderError(
        PC_BRIDGE_PROVIDER_ID,
        'invalid_response',
        'Supabase ไม่ส่งรหัสงานกลับมา',
      );
    }
    return id;
  }

  async getTask(taskId: string): Promise<BusTask | null> {
    return parseTask(
      await this.rpc('mobile_get_task', { p_token: this.config.token, p_task_id: taskId }),
    );
  }

  async claimInbox(limit = 10): Promise<InboxTask[]> {
    return parseInbox(
      await this.rpc('mobile_claim_inbox', { p_token: this.config.token, p_limit: limit }),
    );
  }

  /** false = ไม่ใช่งานที่เครื่องนี้รับไว้ / ปิดไปแล้ว */
  async finishTask(taskId: string, ok: boolean, result: Record<string, unknown>): Promise<boolean> {
    const done = await this.rpc('mobile_finish_task', {
      p_token: this.config.token,
      p_task_id: taskId,
      p_ok: ok,
      p_result: result,
    });
    return done === true;
  }

  private rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    return requestJson<unknown>(PC_BRIDGE_PROVIDER_ID, `${this.config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      timeoutMs: RPC_TIMEOUT_MS,
      headers: {
        apikey: this.config.anonKey,
        // legacy anon key เป็น JWT ต้องส่งใน Authorization ด้วย · publishable key (sb_publishable_…) ใช้แค่ apikey
        ...(this.config.anonKey.startsWith('eyJ')
          ? { Authorization: `Bearer ${this.config.anonKey}` }
          : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}
