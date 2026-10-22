/**
 * @file Agent "โหมดเฝ้า" — "เปิดโหมดเฝ้า" / "ปิดโหมดเฝ้า" / "ฟังตลอด" จากแชทหรือเสียง (ADR-015 ขั้น 4 · อัลตรอน)
 *
 * แค่สลับค่าใน {@link useStandbyStore} — `useLiveVoice` บนหน้าหลักเป็นคนเปิด/ปิดไมค์ตามค่านั้น
 * ไม่ใช้คำว่า "อัลตรอน" ใน pattern: "เปิดโหมดอัลตรอน" อาจหมายถึงเปลี่ยน persona · ไม่ใช้ "เครื่อง" (Rule แย่งเป็น pc_command)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { useStandbyStore } from '../../features/voice/live/standbyStore';

export const STANDBY_AGENT_ID = 'standby';

const TAIL = String.raw`\s*(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|ที)*\s*[.!]?$`;
const MODE = String.raw`(?:โหมด\s*)?(?:เฝ้า(?:ยาม)?|ฟังตลอด|ฟังเบื้องหลัง)(?:\s*โหมด)?`;

export const STANDBY_ON_REPLY =
  'เปิดโหมดเฝ้าแล้วครับ — ไมค์ฟังตลอดแม้สลับไปแอปอื่น (มีแจ้งเตือนค้าง) · อยู่แอปอื่นให้เรียกชื่อก่อน เช่น "อัลตรอน ปรับเสียง 30" · ปิดด้วย "ปิดโหมดเฝ้า" หรือแตะ Orb';
export const STANDBY_OFF_REPLY = 'ปิดโหมดเฝ้าแล้วครับ';

type Store = Pick<ReturnType<typeof useStandbyStore.getState>, 'setEnabled'>;

export function createStandbyAgent(
  store: () => Store = () => useStandbyStore.getState(),
): AgentDefinition {
  return {
    id: STANDBY_AGENT_ID,
    name: 'โหมดเฝ้า',
    description: 'ให้ไมค์ฟังตลอด แม้สลับไปแอปอื่น — ต้องเรียกชื่อก่อนสั่ง',
    capabilities: [
      {
        id: 'standby.toggle',
        label: 'เปิด/ปิดโหมดเฝ้า',
        patterns: [
          new RegExp(`^(?:ช่วย)?(?<command>เปิด|ปิด)\\s*${MODE}${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?<command>เฝ้า|ฟังตลอด)(?:ไว้)?(?:เลย)?${TAIL}`),
          new RegExp(`^(?<command>เลิก|หยุด)\\s*(?:เฝ้า|ฟังตลอด)${TAIL}`),
        ],
        examples: ['เปิดโหมดเฝ้า', 'ปิดโหมดเฝ้า', 'ฟังตลอด'],
      },
    ],
    async run({ commandText }) {
      const on = !/^(?:ปิด|เลิก|หยุด)/.test(commandText);
      await store().setEnabled(on);
      return { reply: on ? STANDBY_ON_REPLY : STANDBY_OFF_REPLY };
    },
  };
}

/** ลงทะเบียน agent โหมดเฝ้า (เรียกซ้ำได้) */
export function registerStandbyAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(STANDBY_AGENT_ID)) registry.register(createStandbyAgent());
}
