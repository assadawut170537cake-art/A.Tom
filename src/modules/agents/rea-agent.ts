/**
 * @file Agent "แกะแอป" — สั่งให้ Mark 55 แกะ APK ของแอปเป้าหมายด้วย REA แล้วตอบ "ทางเข้า" กลับมา (ADR-016)
 *
 * | คำสั่ง                                               | ทำอะไร                                      |
 * |-------------------------------------------------------|---------------------------------------------|
 * | "แกะแอป LINE" / "วิเคราะห์แอป com.x.y"                  | `REVERSE_ENGINEER` → REA บน Mark 55          |
 * | "หาทางเข้าแอป ธนาคาร"                                  | เหมือนกัน                                    |
 * | "แอป LINE มี deep link อะไรบ้าง"                        | เหมือนกัน (ชื่อแอป = เป้าหมาย)                 |
 *
 * ทำไมผ่าน Mark 55: REA เป็น stdio MCP + ต้องมี Java/JADX/apktool — มือถือต่อตรงไม่ได้
 * (`MCPClientBridge` รับแค่ HTTP) → สั่งผ่าน Memory Bus เดิม เหมือนอัลตรอน (ดู {@link createUltronAgent})
 * REA แค่ "บอกช่องทาง" (exported activity / deep link / intent) ไม่ลงมือเปิดเอง — การสั่งจริงอยู่ที่ agent "อุปกรณ์"
 * ⚠️ ผลที่เข้า prompt ของ persona ต้องถูก redact/บีบบรรทัดที่ฝั่ง handler ก่อน (ADR-016 · CLAUDE.md §Security)
 * ⚠️ RuleClassifier มาก่อน → เลี่ยงคำ "เครื่อง/คอม" ในคำสั่ง (ใช้ "แอป") ไม่งั้นโดน pc_command แย่ง
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { MemoryBusClient, type BusTask } from '../../features/pc-bridge/MemoryBusClient';
import { failureAdvice, NOT_CONFIGURED_REPLY, type BusClient } from '../../features/pc-bridge/PcBridgeModule';
import {
  pcBridgeSettings,
  type PcBridgeConfig,
  type PcBridgeSettingsStore,
} from '../../features/pc-bridge/settings';

export const REA_AGENT_ID = 'rea';
export const REVERSE_ENGINEER_INSTRUCTION = 'REVERSE_ENGINEER';
/** ตัดเป้าหมายไม่ให้ยาวเกิน payload 4KB ของ Bus (เหมือน MAX_TEXT_IN_PAYLOAD ใน commands.ts) */
export const MAX_TARGET_LENGTH = 200;
/** จำนวนทางเข้าสูงสุดที่สรุปลงแชท (ที่เหลือบอกเป็นจำนวน) */
export const MAX_DOORS_IN_REPLY = 5;

const TAIL = String.raw`\s*(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|ที|เลย)*\s*[.!?]?$`;

/** ทางเข้าหนึ่งอันที่ REA หาเจอ (ฝั่ง Mark 55 ประกอบจาก manifest) */
interface Door {
  kind?: unknown;
  name?: unknown;
  open?: unknown;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** ผลจาก Mark 55 → ข้อความไทยสั้น ๆ สำหรับแชท/เสียง */
export function describeReaResult(task: BusTask): string {
  const { result } = task;
  if (task.status === 'FAILED' || result.status === 'RE_ERROR') {
    const reason =
      asText(result.error) ?? asText(result.exception) ?? JSON.stringify(result).slice(0, 300);
    return `แกะแอปไม่สำเร็จครับ — ${reason}`;
  }
  const pkg = asText(result.package);
  const head = pkg ? `แกะ ${pkg} แล้วครับ` : 'แกะแอปแล้วครับ';
  const doors = Array.isArray(result.doors) ? (result.doors as Door[]) : [];
  if (doors.length === 0) {
    return `${head} — ไม่เจอทางเข้าที่สั่งจากภายนอกได้ (ไม่มี exported component / deep link)`;
  }
  const lines = doors.slice(0, MAX_DOORS_IN_REPLY).map((door) => {
    const kind = asText(door.kind) ?? 'component';
    const name = asText(door.name) ?? '(ไม่ทราบชื่อ)';
    const open = asText(door.open);
    return `• [${kind}] ${name}${open ? ` → ${open}` : ''}`;
  });
  const more = doors.length > MAX_DOORS_IN_REPLY ? `\n…และอีก ${doors.length - MAX_DOORS_IN_REPLY} ทางเข้า` : '';
  return `${head} เจอ ${doors.length} ทางเข้า:\n${lines.join('\n')}${more}`;
}

export interface ReaAgentDeps {
  settings?: Pick<PcBridgeSettingsStore, 'load'> | undefined;
  createClient?: ((config: PcBridgeConfig) => BusClient) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** รอผลนานสุดเท่านี้ก่อนตอบว่า "ส่งแล้ว" (REA/JADX ใช้เวลาหลายวิ) */
  waitMs?: number | undefined;
  pollMs?: number | undefined;
}

export function createReaAgent(deps: ReaAgentDeps = {}): AgentDefinition {
  const settings = deps.settings ?? pcBridgeSettings;
  const createClient =
    deps.createClient ?? ((config: PcBridgeConfig) => new MemoryBusClient(config));
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const waitMs = deps.waitMs ?? 20_000;
  const pollMs = deps.pollMs ?? 1_500;

  async function analyze(client: BusClient, target: string) {
    let taskId: string;
    try {
      taskId = await client.submitTask(REVERSE_ENGINEER_INSTRUCTION, {
        target: target.slice(0, MAX_TARGET_LENGTH),
      });
    } catch (e) {
      return { reply: `ส่งคำสั่งแกะแอปไม่สำเร็จ — ${failureAdvice(e)}` };
    }
    try {
      for (let waited = 0; waited < waitMs; waited += pollMs) {
        await sleep(pollMs);
        const task = await client.getTask(taskId);
        if (task && (task.status === 'COMPLETED' || task.status === 'FAILED'))
          return { reply: describeReaResult(task) };
      }
    } catch (e) {
      return { reply: `ส่งแล้ว แต่อ่านผลไม่ได้ — ${failureAdvice(e)}` };
    }
    return {
      reply:
        'ส่งให้ Mark 55 แกะแอปแล้วครับ · ยังแกะไม่เสร็จ (อาจใช้เวลาสักครู่ หรือ Mark 55 ปิดอยู่) — เสร็จแล้วจะแจ้งผลกลับมาเอง',
    };
  }

  return {
    id: REA_AGENT_ID,
    name: 'แกะแอป',
    description: 'ให้ Mark 55 แกะ APK ด้วย REA แล้วบอก "ทางเข้า" ของแอป (exported / deep link / intent)',
    capabilities: [
      {
        id: 'rea.doors',
        label: 'หาทางเข้าของแอป',
        patterns: [
          new RegExp(String.raw`^(?:ช่วย\s*)?(?:แกะ|วิเคราะห์)\s*แอป\s*(?<command>\S[\s\S]*?)${TAIL}`),
          new RegExp(String.raw`^หาทางเข้า(?:ของ)?(?:แอป)?\s*(?<command>\S[\s\S]*?)${TAIL}`),
          new RegExp(String.raw`^แอป\s*(?<command>\S[\s\S]+?)\s*มี\s*(?:deep\s?link|ดีพลิงก์|ลิงก์|ทางเข้า|อะไรให้สั่ง)[\s\S]*$`, 'i'),
          /^reverse(?:\s*engineer)?\s*(?:แอป\s*)?(?<command>\S[\s\S]*)$/i,
        ],
        examples: [
          'แกะแอป com.example.app',
          'หาทางเข้าแอป LINE',
          'แอป LINE มี deep link อะไรบ้าง',
        ],
      },
    ],
    async run({ commandText }) {
      const target = commandText.trim();
      if (!target) return { reply: 'บอกชื่อแอปหรือพาธ APK ที่จะแกะด้วยครับ (เช่น "แกะแอป com.example.app")' };
      const config = await settings.load();
      if (!config) return { reply: NOT_CONFIGURED_REPLY };
      return analyze(createClient(config), target);
    },
  };
}

/** ลงทะเบียน agent แกะแอป (เรียกซ้ำได้) */
export function registerReaAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(REA_AGENT_ID)) registry.register(createReaAgent());
}
