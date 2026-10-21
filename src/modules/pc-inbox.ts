/**
 * @file ต่อ {@link PcInbox} (PC → มือถือ) เข้ากับแชท + เสียง + DeviceControlBridge ของแอป
 *
 * อยู่ระดับแอป (ไม่ใช่ features/pc-bridge) เพราะต้องใช้ทั้ง store ของหน้าหลัก และ `deviceConfirmations`
 * ที่ agent อุปกรณ์ใช้ — คำสั่งเสี่ยงจาก PC จึงยืนยันด้วย "ยืนยัน" ในแชทได้เหมือนคำสั่งจากบอสเอง
 * boot เรียก `pcInbox.start()` · ยังไม่ตั้งค่า Mark 55 Bus = แต่ละรอบแค่อ่านค่าตั้งแล้วจบ
 */

import { deviceControl } from '../core/agent/DeviceControlBridge';
import type { AgentToolCall } from '../core/agent/types';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { MemoryBusClient } from '../features/pc-bridge/MemoryBusClient';
import { NOTIFY_PREFIX, PcInbox, type InboxHandlers } from '../features/pc-bridge/PcInbox';
import { pcBridgeSettings } from '../features/pc-bridge/settings';
import { voiceOrchestrator } from '../features/voice/core/VoiceOrchestrator';
import { deviceConfirmations } from './agents/confirmations';

export { NOTIFY_PREFIX };

export const appInboxHandlers: InboxHandlers = {
  notify(text, speak) {
    const store = useAtomStore.getState();
    store.pushMessage({ role: 'assistant', content: `${NOTIFY_PREFIX}${text}` });
    // พูดเฉพาะตอนผู้ช่วยว่าง — ระหว่างฟัง (โหมดไลฟ์/เฝ้า) ไมค์จะได้ยินเสียงตัวเองแล้วกลายเป็นคำสั่ง
    if (speak && store.mood === 'idle') {
      void voiceOrchestrator
        .speak(text, store.activePersona)
        .catch((e: unknown) => console.error('[pc-bridge] พูดข้อความจาก Mark 55 ไม่ได้', e));
    }
  },
  async deviceTool(call) {
    const result = await deviceControl.call(call);
    if (result.needsConfirmation) {
      deviceConfirmations.hold(call, (c: AgentToolCall) => deviceControl.call(c));
    }
    useAtomStore
      .getState()
      .pushMessage({ role: 'system', content: `Mark 55 สั่งมือถือ: ${result.output}` });
    return result;
  },
};

export const pcInbox = new PcInbox({
  settings: pcBridgeSettings,
  createClient: (config) => new MemoryBusClient(config),
  handlers: appInboxHandlers,
});
