/**
 * @file Agent "อุปกรณ์" — สั่งงานมือถือจากแชท/เสียงตรง ๆ ผ่าน {@link DeviceControlBridge} (ADR-015 ระดับ A + B)
 *
 * | คำสั่ง                                                  | tool                           |
 * |---------------------------------------------------------|--------------------------------|
 * | "ปรับเสียง 30" / "เสียง 30%" / "volume 30"                | `device.volume`                |
 * | "ปรับความสว่าง 50" / "ความสว่างจอ 80%"                    | `device.brightness`            |
 * | "เปิดไฟฉาย" / "ปิดไฟฉาย" / "flashlight on"               | `device.flashlight`            |
 * | "คัดลอกว่า …" / "copy: …"                                | `device.clipboard`             |
 * | "เปิดแอป LINE" · "เปิดแอป LINE แล้วกด แชท"                 | `device.launch` (+ `device.tap`) |
 * | "ย้อนกลับ" · "กลับหน้าโฮม" · "เปิดแจ้งเตือน" · "ล็อกจอ" · "แคปจอ" | `device.nav`               |
 * | "กดปุ่ม ถัดไป" · "แตะ ตกลง"                                | `device.tap`                   |
 * | "พิมพ์ว่า …"                                              | `device.type`                  |
 * | "อ่านหน้าจอ"                                             | `device.read_screen`           |
 * | "เปิดสิทธิ์ควบคุมมือถือ"                                     | `device.accessibility_settings` |
 * | "ยืนยัน" / "ยกเลิก" (หลังกดปุ่มเสี่ยง)                       | ทำ/ทิ้งคำสั่งที่รอยืนยัน          |
 *
 * ใช้ regex ไม่ผ่าน LLM: เร็ว ใช้ออฟไลน์ได้ และตีความผิดไม่ได้ · pattern ต้องมีตัวเลข / คำกริยาเฉพาะเสมอ
 * (แคบพอไม่แย่งประโยคคุยปกติ เพราะ AgentClassifier มาก่อน Jev/LLM)
 * ⚠️ Rule มาก่อน Agent → ประโยคที่มี "เปิด/ปิด" + "เครื่อง" (เช่น "เปิดแอปเครื่องคิดเลข") ไปเป็น `pc_command`
 * ⚠️ กด/พิมพ์/อ่านจอ ทำกับแอปหน้าสุด — สั่งจากแชทในแอปเรา = ทำในแอปเรา → ใช้ "เปิดแอป X แล้วกด Y"
 * เลขเป็นคำไทย ("ปรับเสียงสามสิบ", "ความสว่างครึ่ง") แปลงด้วย {@link parseThaiNumber} เพราะ STT บางตัวถอดเป็นคำ
 * การควบคุมอุปกรณ์ปิดอยู่ → bridge ตอบข้อความไทยชี้ไป ตั้งค่า › Marketplace เอง
 */

import { deviceControl, type DeviceControlBridge } from '../../core/agent/DeviceControlBridge';
import type { AgentToolCall, AgentToolResult } from '../../core/agent/types';
import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition, AgentRunResult } from '../../core/agents/types';
import {
  CONFIRM_WINDOW_MS,
  createConfirmationStore,
  deviceConfirmations,
  type ConfirmationStore,
} from './confirmations';
import { parseThaiNumber, THAI_NUMBER_PATTERN } from './thaiNumber';

export const DEVICE_AGENT_ID = 'device';

export { CONFIRM_WINDOW_MS };
/** "เปิดแอป X แล้วกด Y" — รอให้แอปที่เพิ่งเปิดวาดจอเสร็จได้นานสุดเท่านี้ */
export const LAUNCH_THEN_TAP_TIMEOUT_MS = 6_000;

/** คำลงท้ายที่ STT / การพิมพ์มักแถมมา ("ปรับเสียง 30 ครับ", "เปิดไฟฉายหน่อย!") */
const TAIL = String.raw`\s*(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|ที)*\s*[.!]?$`;
const LEVEL = String.raw`\s*(?:เป็น|ไปที่|ที่|ให้เป็น)?\s*(?<command>\d{1,3}(?:\.\d+)?|${THAI_NUMBER_PATTERN})\s*(?:%|เปอร์เซ็นต์|เปอร์เซ็น)?`;
const VERB = String.raw`^(?:ช่วย)?(?:ปรับ|ตั้ง|เปลี่ยน)?\s*`;
const QUOTED = String.raw`["“'‘]?(?<command>.+?)["”'’]?`;
/** "เปิดแอป LINE แล้วกด แชท" → ชื่อแอป + สิ่งที่จะกด */
const THEN_TAP = /\s*แล้ว(?:ก็)?\s*(?:กด|แตะ|คลิก)(?:ปุ่ม|ที่|คำว่า)?\s*/;

/** capability → tool ของ DeviceControlBridge (ส่วนใหญ่ id เดียวกันเพื่อให้ตามรอยง่าย) */
const TOOL_OF: Record<string, string> = {
  'device.volume': 'device.volume',
  'device.brightness': 'device.brightness',
  'device.flashlight': 'device.flashlight',
  'device.clipboard': 'device.clipboard',
  'device.launch': 'device.launch',
  'device.nav': 'device.nav',
  'device.tap': 'device.tap',
  'device.type': 'device.type',
  'device.read_screen': 'device.read_screen',
  'device.accessibility_settings': 'device.accessibility_settings',
};

const reply = (result: AgentToolResult): AgentRunResult => ({
  reply: result.ok ? `${result.output}ครับ` : result.output,
});

export function createDeviceAgent(
  bridge: DeviceControlBridge = deviceControl,
  now: () => number = Date.now,
  /** ใช้ร่วมกับ agent งาน (แอปส่ง `deviceConfirmations`) · ไม่ส่ง = ของตัวเอง (test แยกกันได้) */
  confirmations: ConfirmationStore = createConfirmationStore(now),
): AgentDefinition {
  const execute = (call: AgentToolCall) => bridge.call(call);

  /** เรียก bridge · ถ้าต้องยืนยัน → จำไว้ให้ "ยืนยัน" รอบหน้า */
  async function run(call: AgentToolCall): Promise<AgentToolResult> {
    const result = await bridge.call(call);
    if (result.needsConfirmation) confirmations.hold(call, execute);
    return result;
  }

  return {
    id: DEVICE_AGENT_ID,
    name: 'อุปกรณ์',
    description: 'ปรับเสียง ความสว่าง ไฟฉาย เปิดแอป กดปุ่ม พิมพ์ และอ่านหน้าจอบนมือถือ',
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
      {
        id: 'device.accessibility_settings',
        label: 'เปิดสิทธิ์ควบคุมมือถือ',
        patterns: [
          // ไม่ใช้คำว่า "เครื่อง" — RuleClassifier จะแย่งไปเป็น pc_command
          new RegExp(
            `^(?:ช่วย)?เปิด(?:สิทธิ์|สิทธิ)?\\s*(?:ควบคุมมือถือ|การช่วยเหลือพิเศษ|accessibility)${TAIL}`,
            'i',
          ),
        ],
        examples: ['เปิดสิทธิ์ควบคุมมือถือ'],
      },
      {
        id: 'device.launch',
        label: 'เปิดแอป',
        patterns: [
          new RegExp(
            `^(?:ช่วย)?เปิดแอป(?:พลิเคชัน|พลิเคชั่น)?\\s*(?!ไม่|ยังไง|อะไร|ไหน|ได้)(?<command>\\S[\\s\\S]*?)${TAIL}`,
          ),
          /^open\s+(?:the\s+)?app\s+(?<command>.+)$/i,
        ],
        examples: ['เปิดแอป LINE', 'เปิดแอป YouTube แล้วกด ค้นหา'],
      },
      {
        id: 'device.nav',
        label: 'ปุ่มระบบ',
        patterns: [
          new RegExp(`^(?:ช่วย)?(?:กด)?\\s*(?<command>ย้อนกลับ)${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?:กด|กลับ(?:ไป)?|ไป)?\\s*(?:หน้า)?(?<command>โฮม)${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?:เปิด|ดู|แสดง)\\s*(?:แถบ)?(?<command>แจ้งเตือน)${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?:เปิด|ดู)?\\s*(?<command>แอปล่าสุด|สลับแอป)${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?:เปิด)?\\s*(?<command>ตั้งค่าด่วน)${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?<command>ล็อก|ล็อค)\\s*(?:หน้า)?จอ(?:มือถือ)?${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?<command>แคป|จับภาพ)\\s*(?:หน้า)?จอ${TAIL}`),
          /^(?:press\s+|go\s+)?(?<command>back|home)$/i,
        ],
        examples: ['ย้อนกลับ', 'กลับหน้าโฮม', 'เปิดแจ้งเตือน', 'ล็อกจอ', 'แคปหน้าจอ'],
      },
      {
        id: 'device.tap',
        label: 'กดบนหน้าจอ',
        patterns: [
          // ต้องมี ปุ่ม/ที่/คำว่า หรือเว้นวรรคหลัง "กด" — กัน "กดดัน", "กดไลก์ไม่ได้" (ประโยคคุย)
          new RegExp(`^(?:ช่วย)?(?:กด|แตะ|คลิก)(?:ปุ่ม|ที่|คำว่า)\\s*${QUOTED}${TAIL}`),
          new RegExp(`^(?:ช่วย)?(?:กด|แตะ|คลิก)\\s+${QUOTED}${TAIL}`),
          /^(?:tap|click|press)\s+(?:on\s+)?["']?(?<command>.+?)["']?$/i,
        ],
        examples: ['กดปุ่ม ถัดไป', 'แตะ ตกลง'],
      },
      {
        id: 'device.type',
        label: 'พิมพ์ข้อความ',
        patterns: [
          /^(?:ช่วย)?พิมพ์(?:ข้อความ)?\s*(?:ว่า|:)\s*(?<command>[\s\S]+)$/,
          /^type\s*:\s*(?<command>[\s\S]+)$/i,
        ],
        examples: ['พิมพ์ว่า สวัสดีครับ'],
      },
      {
        id: 'device.read_screen',
        label: 'อ่านหน้าจอ',
        patterns: [
          new RegExp(`^(?:ช่วย)?(?:อ่าน|ดู)(?:ข้อความ(?:บน|ใน))?หน้าจอ(?:ให้ฟัง)?${TAIL}`),
          /^read\s+(?:the\s+)?screen$/i,
        ],
        examples: ['อ่านหน้าจอ'],
      },
      {
        id: 'device.confirm',
        label: 'ยืนยันคำสั่งเสี่ยง',
        patterns: [
          new RegExp(`^(?<command>ยืนยัน)(?:กด|คำสั่ง)?${TAIL}`),
          /^(?<command>confirm)$/i,
        ],
        examples: ['ยืนยัน'],
      },
      {
        id: 'device.cancel',
        label: 'ยกเลิกคำสั่งเสี่ยง',
        patterns: [new RegExp(`^(?<command>ยกเลิก)(?:คำสั่ง)?${TAIL}`)],
        examples: ['ยกเลิก'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'device.confirm') {
        const result = await confirmations.confirm();
        return result ? reply(result) : { reply: 'ไม่มีคำสั่งที่รอยืนยันครับ' };
      }
      if (capabilityId === 'device.cancel') {
        return {
          reply: confirmations.cancel()
            ? 'ยกเลิกแล้วครับ ไม่ได้กดอะไร'
            : 'ไม่มีคำสั่งที่รอยืนยันครับ',
        };
      }

      const tool = capabilityId ? TOOL_OF[capabilityId] : undefined;
      if (!tool)
        return {
          reply: 'ไม่เข้าใจคำสั่งอุปกรณ์ครับ — ลองพิมพ์เช่น "ปรับเสียง 30" หรือ "เปิดไฟฉาย"',
        };

      if (tool === 'device.launch') {
        const [name = '', tapTarget] = commandText.split(THEN_TAP);
        const launched = await run({ tool, text: name.trim() });
        if (!launched.ok || !tapTarget?.trim()) return reply(launched);
        const tapped = await run({
          tool: 'device.tap',
          text: tapTarget.trim(),
          args: { timeoutMs: LAUNCH_THEN_TAP_TIMEOUT_MS },
        });
        return {
          reply: tapped.ok
            ? `${launched.output} · ${tapped.output}ครับ`
            : `${launched.output} แต่${tapped.output}`,
        };
      }

      // ระดับเป็นคำไทย → ตัวเลขก่อนส่ง (parseLevel ของ bridge อ่านได้แค่ตัวเลข)
      const isLevel = tool === 'device.volume' || tool === 'device.brightness';
      const level = isLevel ? parseThaiNumber(commandText) : null;
      const text = level === null ? commandText : String(level);
      return reply(await run({ tool, text }));
    },
  };
}

/** ลงทะเบียน agent อุปกรณ์ (เรียกซ้ำได้ — fast refresh / bootApp ซ้ำ) */
export function registerDeviceAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(DEVICE_AGENT_ID))
    registry.register(createDeviceAgent(deviceControl, Date.now, deviceConfirmations));
}
