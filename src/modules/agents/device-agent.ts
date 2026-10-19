/**
 * @file Agent "อุปกรณ์" — สั่งงานมือถือจากแชท/เสียงตรง ๆ ผ่าน {@link DeviceControlBridge} (ADR-015 ระดับ A)
 *
 * | คำสั่ง                                       | tool                |
 * |----------------------------------------------|---------------------|
 * | "ปรับเสียง 30" / "เสียง 30%" / "volume 30"     | `device.volume`     |
 * | "ปรับความสว่าง 50" / "ความสว่างจอ 80%"         | `device.brightness` |
 * | "เปิดไฟฉาย" / "ปิดไฟฉาย" / "flashlight on"    | `device.flashlight` |
 * | "คัดลอกว่า …" / "copy: …"                     | `device.clipboard`  |
 *
 * ใช้ regex ไม่ผ่าน LLM: เร็ว ใช้ออฟไลน์ได้ และตีความระดับผิดไม่ได้ · pattern ต้องมีตัวเลข/คำว่าเปิด-ปิดเสมอ
 * (แคบพอไม่แย่งประโยคคุยปกติ เพราะ AgentClassifier มาก่อน Jev/LLM)
 * ⚠️ Rule มาก่อน Agent → ประโยคที่มี "เปิด/ปิด" + "เครื่อง" (เช่น "ปิดเสียงเครื่อง") ไปเป็น `pc_command`
 * เลขเป็นคำไทย ("ปรับเสียงสามสิบ", "ความสว่างครึ่ง") แปลงด้วย {@link parseThaiNumber} เพราะ STT บางตัวถอดเป็นคำ
 * การควบคุมอุปกรณ์ปิดอยู่ → bridge ตอบข้อความไทยชี้ไป ตั้งค่า › Marketplace เอง
 */

import { deviceControl, type DeviceControlBridge } from '../../core/agent/DeviceControlBridge';
import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { parseThaiNumber, THAI_NUMBER_PATTERN } from './thaiNumber';

export const DEVICE_AGENT_ID = 'device';

/** คำลงท้ายที่ STT / การพิมพ์มักแถมมา ("ปรับเสียง 30 ครับ", "เปิดไฟฉายหน่อย!") */
const TAIL = String.raw`\s*(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|ที)*\s*[.!]?$`;
const LEVEL = String.raw`\s*(?:เป็น|ไปที่|ที่|ให้เป็น)?\s*(?<command>\d{1,3}(?:\.\d+)?|${THAI_NUMBER_PATTERN})\s*(?:%|เปอร์เซ็นต์|เปอร์เซ็น)?`;
const VERB = String.raw`^(?:ช่วย)?(?:ปรับ|ตั้ง|เปลี่ยน)?\s*`;

/** capability → tool ของ DeviceControlBridge (id เดียวกันเพื่อให้ตามรอยง่าย) */
const TOOL_OF: Record<string, string> = {
  'device.volume': 'device.volume',
  'device.brightness': 'device.brightness',
  'device.flashlight': 'device.flashlight',
  'device.clipboard': 'device.clipboard',
};

export function createDeviceAgent(bridge: DeviceControlBridge = deviceControl): AgentDefinition {
  return {
    id: DEVICE_AGENT_ID,
    name: 'อุปกรณ์',
    description: 'ปรับเสียง ความสว่าง ไฟฉาย และคัดลอกข้อความบนมือถือ',
    capabilities: [
      {
        id: 'device.volume',
        label: 'ปรับเสียง',
        patterns: [
          new RegExp(`${VERB}(?:ระดับ)?เสียง(?:เพลง|สื่อ)?${LEVEL}${TAIL}`),
          /^(?:set\s+)?volume\s*(?:to\s*)?(?<command>\d{1,3})\s*%?$/i,
        ],
        examples: ['ปรับเสียง 30', 'เสียง 50%', 'volume 20'],
      },
      {
        id: 'device.brightness',
        label: 'ปรับความสว่าง',
        patterns: [
          new RegExp(`${VERB}(?:ความ)?สว่าง(?:หน้าจอ|จอ)?${LEVEL}${TAIL}`),
          /^(?:set\s+)?brightness\s*(?:to\s*)?(?<command>\d{1,3})\s*%?$/i,
        ],
        examples: ['ปรับความสว่าง 50', 'ความสว่างจอ 80%'],
      },
      {
        id: 'device.flashlight',
        label: 'เปิด/ปิดไฟฉาย',
        patterns: [
          new RegExp(`^(?:ช่วย)?(?<command>เปิด|ปิด)\\s*ไฟฉาย${TAIL}`),
          /^(?:turn\s+)?(?<command>on|off)\s+(?:the\s+)?(?:flashlight|torch)$/i,
          /^(?:flashlight|torch)\s+(?<command>on|off)$/i,
        ],
        examples: ['เปิดไฟฉาย', 'ปิดไฟฉายหน่อย', 'flashlight on'],
      },
      {
        id: 'device.clipboard',
        label: 'คัดลอกข้อความ',
        patterns: [
          /^(?:ช่วย)?คัดลอก(?:ข้อความ)?(?:ไว้)?\s*(?:ว่า|:)\s*(?<command>[\s\S]+)$/,
          /^copy\s*:\s*(?<command>[\s\S]+)$/i,
        ],
        examples: ['คัดลอกว่า 0812345678', 'copy: hello'],
      },
    ],
    async run({ commandText, capabilityId }) {
      const tool = capabilityId ? TOOL_OF[capabilityId] : undefined;
      if (!tool)
        return {
          reply: 'ไม่เข้าใจคำสั่งอุปกรณ์ครับ — ลองพิมพ์เช่น "ปรับเสียง 30" หรือ "เปิดไฟฉาย"',
        };
      // ระดับเป็นคำไทย → ตัวเลขก่อนส่ง (parseLevel ของ bridge อ่านได้แค่ตัวเลข)
      const isLevel = tool === 'device.volume' || tool === 'device.brightness';
      const level = isLevel ? parseThaiNumber(commandText) : null;
      const text = level === null ? commandText : String(level);
      const result = await bridge.call({ tool, text });
      return { reply: result.ok ? `${result.output}ครับ` : result.output };
    },
  };
}

/** ลงทะเบียน agent อุปกรณ์ (เรียกซ้ำได้ — fast refresh / bootApp ซ้ำ) */
export function registerDeviceAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(DEVICE_AGENT_ID)) registry.register(createDeviceAgent());
}
