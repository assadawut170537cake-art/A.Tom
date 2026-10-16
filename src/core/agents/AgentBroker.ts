// src/core/agents/AgentBroker.ts

import { AgentRegistry, agentRegistry } from './AgentRegistry';
import { AgentResult } from './types';

export class AgentBroker {
  // ควบคุมระยะเวลาไม่ให้เอเจนตัวใดรันค้างเกิน 8 วินาที (เปลี่ยนตัวเลขนี้ได้ตามใจชอบ)
  private readonly EXECUTION_TIMEOUT = 8000;

  constructor(private readonly registry: AgentRegistry) {}

  /** ค้นหาและรันเอเจนแบบปลอดภัย มีกลไกป้องกัน Timeout และ Sandbox Recovery */
  async executeCommandSafe(agentId: string, input: string): Promise<AgentResult> {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.enabled) {
      return { reply: "❌ เอเจนระบบนี้ปิดใช้งานอยู่ หรือหาไม่พบ" };
    }

    // สร้าง Promise ดักความช้า (Timeout)
    const timeoutPromise = new Promise<AgentResult>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[Timeout] เอเจน "${agent.name}" ทำงานช้าเกินความเร็วที่กำหนด (${this.EXECUTION_TIMEOUT}ms)`)),
        this.EXECUTION_TIMEOUT
      )
    );

    try {
      // แข่งกันทำงาน ระหว่างเอเจจรันจริง กับ ตัวดักจับเวลา Timeout
      const result = await Promise.race([
        agent.handle(input),
        timeoutPromise
      ]);

      return result;
    } catch (error) {
      // 🛡️ Sandbox Catch: ดัก Error ทุกชนิดให้อยู่แค่ในห้องทดลองนี้ ไม่ให้พังแอพใหญ่
      const message = error instanceof Error ? error.message : String(error);
      console.error(`🚨 [Sandbox Blocked] เกิดข้อผิดพลาดในเอเจน "${agent.id}":`, error);

      return {
        reply: `⚠️ ตรวจพบการหยุดทำงานกะทันหันในเอเจน "${agent.name}": ${message}`,
        data: { hasError: true, rawError: message }
      };
    }
  }
}

/** Singleton broker ใช้ทั่วแอป — รับคำสั่งแล้วส่งเข้า sandbox ของเอเจน */
export const agentBroker = new AgentBroker(agentRegistry);
