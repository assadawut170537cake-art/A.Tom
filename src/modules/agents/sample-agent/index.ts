// src/modules/agents/sample-agent/index.ts

import type { AtomAgent, AgentResult } from '../../../core/agents/types';

export const sampleAgent: AtomAgent = {
  id: 'sample-agent',
  name: 'Sample Sandbox Tester',
  version: '1.0.0',
  enabled: true,
  capabilities: [
    {
      intent: 'note',
      description: 'บันทึกโน้ตหรือข้อความด่วน',
      example: 'จดบันทึกว่า พรุ่งนี้เข้าไซต์งาน 9 โมง',
    },
    {
      intent: 'test_crash',
      description: 'ทดสอบให้เอเจนโยน Exception Error กลางคัน',
      example: 'crash',
    },
    {
      intent: 'test_timeout',
      description: 'ทดสอบให้เอเจนทำงานค้างเกิน 8 วินาที',
      example: 'timeout',
    },
  ],

  async handle(input: string): Promise<AgentResult> {
    const cleanText = input.trim().toLowerCase();

    // 💣 กรณีที่ 1: ผู้ใช้สั่งคำสั่ง 'crash'
    if (cleanText.includes('crash')) {
      throw new Error('💥 จำลอง Exception บั๊กใน Logic สำเร็จ! Broker ควรดักจับได้ทันที');
    }

    // ⏳ กรณีที่ 2: ผู้ใช้สั่งคำสั่ง 'timeout' (จำลองการรันนาน 12 วินาที เกินเพดาน 8 วินาที)
    if (cleanText.includes('timeout')) {
      await new Promise((resolve) => setTimeout(resolve, 12000));
      return { reply: 'รันเสร็จแล้ว (แต่ไม่ควรได้เห็นข้อความนี้เพราะต้องโดนตัด Timeout ก่อน)' };
    }

    // ✅ กรณีที่ 3: สั่งงานทั่วไป
    return {
      reply: `[Sample Agent] ได้รับคำสั่ง "${input}" เรียบร้อยแล้วครับ! สถานะระบบ: ปกติสมบูรณ์ 🚀`,
      data: {
        timestamp: Date.now(),
        receivedInput: input,
      },
      shouldNavigate: true, // แจ้งให้เปิดหน้า UI ของตัวมันเองขึ้นมาแสดงด้วย
    };
  },

  // 📦 โหลด UI หน้าจอของตัวเองแบบ Dynamic Import (ประหยัด RAM)
  async getScreenComponent() {
    const module = await import('./SampleAgentScreen');
    return module.SampleAgentScreen;
  },
};
