/**
 * @file คำสั่งเสี่ยงที่รอบอส "ยืนยัน" — ใช้ร่วมกันระหว่าง agent "อุปกรณ์" (regex) กับ agent "งาน" (AgentHarness)
 *
 * แยกออกมาเพราะคำว่า "ยืนยัน" / "ยกเลิก" จับโดย agent อุปกรณ์ตัวเดียว แต่คำสั่งที่รออาจมาจาก agent งาน
 * (LLM เลือกกดปุ่ม "ส่ง") — ถ้าเก็บแยกกัน "ยืนยัน" จะหาคำสั่งไม่เจอ
 * มีได้ทีละคำสั่ง (ตัวใหม่ทับตัวเก่า) · หมดอายุตาม {@link CONFIRM_WINDOW_MS} เพราะนานไปจอเปลี่ยนแล้ว กดอาจผิดปุ่ม
 */

import type { AgentToolCall, AgentToolResult } from '../../core/agent/types';

/** คำสั่งเสี่ยงที่รอยืนยันได้นานเท่านี้ (ms) */
export const CONFIRM_WINDOW_MS = 60_000;

export interface ConfirmationStore {
  /** จำคำสั่งที่รอยืนยัน + วิธีรันเมื่อบอสยืนยัน (ทับตัวเดิม) */
  hold(call: AgentToolCall, execute: (call: AgentToolCall) => Promise<AgentToolResult>): void;
  /** รันคำสั่งที่รอด้วย `args.confirmed: true` · null = ไม่มี/หมดอายุแล้ว */
  confirm(): Promise<AgentToolResult | null>;
  /** ทิ้งคำสั่งที่รอ · false = ไม่มีอะไรรออยู่ */
  cancel(): boolean;
}

export function createConfirmationStore(now: () => number = Date.now): ConfirmationStore {
  let pending: {
    call: AgentToolCall;
    execute: (call: AgentToolCall) => Promise<AgentToolResult>;
    expiresAt: number;
  } | null = null;

  /** ตัวที่ยังไม่หมดอายุ แล้วล้างทิ้ง (ใช้ได้ครั้งเดียว) */
  const take = () => {
    const waiting = pending;
    pending = null;
    return waiting && now() <= waiting.expiresAt ? waiting : null;
  };

  return {
    hold(call, execute) {
      pending = { call, execute, expiresAt: now() + CONFIRM_WINDOW_MS };
    },
    async confirm() {
      const waiting = take();
      if (!waiting) return null;
      return waiting.execute({ ...waiting.call, args: { ...waiting.call.args, confirmed: true } });
    },
    cancel() {
      return take() !== null;
    },
  };
}

/** ตัวที่แอปใช้ (boot ส่งให้ทั้ง agent อุปกรณ์ และ agent งาน) */
export const deviceConfirmations = createConfirmationStore();
