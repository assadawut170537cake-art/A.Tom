/**
 * @file Agent "อัลตรอน" — ให้ AI เขียนโค้ดแล้วส่งไปรันใน Docker sandbox บน Mark 55 · บอส "ปลด" / "ทำลาย" (ADR-015 ขั้น 4)
 *
 * | คำสั่ง                                                         | ทำอะไร                                   |
 * |----------------------------------------------------------------|------------------------------------------|
 * | "อัลตรอน ทำว่า …" / "ให้อัลตรอนเขียนโค้ดว่า …" / "รันในแซนด์บ็อกซ์ว่า …" / "sandbox: …" | LLM เขียน Python → `ULTRON_RUN` |
 * | "ปลด" / "ปลด sandbox 1a2b"                                       | `ULTRON_RELEASE` (ตัวล่าสุดถ้าไม่บอกรหัส)  |
 * | "ทำลาย" / "ทำลาย 1a2b"                                          | `ULTRON_DESTROY`                          |
 *
 * ทำไม LLM อยู่ฝั่งมือถือ: ใช้ AI ที่บอสตั้งไว้แล้ว (ตั้งค่า › AI) ไม่ต้องใส่ key เพิ่มบน PC · PC แค่รันให้ใน sandbox
 * (`mark55/ultron_sandbox.py`: ไม่มีเน็ต · root อ่านอย่างเดียว · จำกัด RAM/CPU/เวลา) — โค้ดไม่แตะเครื่องจริงจนกว่าบอสเอาไปใช้เอง
 * ผลรัน: Mark 55 แจ้งกลับทาง inbox (NOTIFY · ต้องรัน sql/003) เพราะรันนานกว่าที่แชทรอ · ปลด/ทำลาย เร็ว → รอผลตอบเลย
 * ⚠️ background (โหมดเฝ้า) ตัดชื่อที่เรียกออกก่อน → "อัลตรอน ทำว่า …" เหลือ "ทำว่า …" ไม่ match — ใช้ "อัลตรอน รันในแซนด์บ็อกซ์ว่า …"
 * ⚠️ มี "เปิด/ปิด/สั่ง" + "คอม/เครื่อง" ในประโยค → RuleClassifier แย่งเป็น pc_command (เหมือน agent อื่น)
 */

import type { AgentLLM } from '../../core/agent/types';
import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { redactSecrets } from '../../core/http/errors';
import { orchestratorLLM } from '../../features/ai/agent';
import { MemoryBusClient, type BusTask } from '../../features/pc-bridge/MemoryBusClient';
import {
  failureAdvice,
  NOT_CONFIGURED_REPLY,
  shortId,
  type BusClient,
} from '../../features/pc-bridge/PcBridgeModule';
import {
  pcBridgeSettings,
  type PcBridgeConfig,
  type PcBridgeSettingsStore,
} from '../../features/pc-bridge/settings';

export const ULTRON_AGENT_ID = 'ultron';
/** ตรงกับ MAX_CODE_BYTES ใน mark55/ultron_sandbox.py */
export const MAX_CODE_BYTES = 12_000;

export const ULTRON_CODE_PROMPT = [
  'คุณคืออัลตรอน เขียนโค้ด Python 3.12 ไฟล์เดียวทำงานที่บอสสั่ง',
  'โค้ดรันใน sandbox: ไม่มีอินเทอร์เน็ต · ใช้ได้แค่ standard library (ห้าม pip install) · เขียนไฟล์ได้เฉพาะโฟลเดอร์ปัจจุบัน และ /tmp · ต้องจบภายใน 2 นาที',
  'พิมพ์สรุปผลด้วย print() ให้บอสอ่านรู้เรื่อง (ภาษาไทยได้)',
  'ตอบเป็นโค้ดล้วนใน ```python``` block เดียว ไม่ต้องอธิบาย',
].join('\n');

const TAIL = String.raw`\s*(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|นะ|เลย)*\s*[.!]?$`;
const SANDBOX = String.raw`(?:sandbox|แซนด์บ็อกซ์|แซนบ็อก(?:ซ์)?)`;

export interface UltronAgentDeps {
  settings?: Pick<PcBridgeSettingsStore, 'load'> | undefined;
  createClient?: ((config: PcBridgeConfig) => BusClient) | undefined;
  llm?: AgentLLM | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** ปลด/ทำลาย: รอผลนานสุดเท่านี้ */
  waitMs?: number | undefined;
  pollMs?: number | undefined;
}

/** ดึงโค้ดจากคำตอบ LLM — มี ``` block ใช้ตัวแรก ไม่มีก็ใช้ทั้งข้อความ */
export function extractCode(reply: string): string {
  const block = reply.match(/```(?:python|py)?[^\n]*\n([\s\S]*?)```/i)?.[1];
  return (block ?? reply).trim();
}

/** "ปลด" / "ทำลาย 1a2b" → action + รหัส (ไม่มี = ล่าสุด) */
export function parseDecision(text: string): {
  instruction: 'ULTRON_RELEASE' | 'ULTRON_DESTROY';
  ref: string;
} {
  const ref = text.match(/[0-9a-f]{4,8}/i)?.[0]?.toLowerCase() ?? 'latest';
  return { instruction: /ทำลาย|destroy/i.test(text) ? 'ULTRON_DESTROY' : 'ULTRON_RELEASE', ref };
}

/** ผลของปลด/ทำลายจาก Mark 55 → ข้อความไทย */
export function describeDecision(task: BusTask): string {
  const { result } = task;
  const id = typeof result.sandbox_id === 'string' ? result.sandbox_id : '';
  if (task.status === 'FAILED' || result.status === 'ULTRON_ERROR') {
    const reason = typeof result.error === 'string' ? result.error : JSON.stringify(result);
    return `อัลตรอนทำไม่ได้ครับ — ${reason}`;
  }
  if (result.status === 'RELEASED') {
    const path = typeof result.path === 'string' ? ` · ผลอยู่ที่ ${result.path} บน Mark 55` : '';
    return `ปลด sandbox ${id} แล้วครับ${path} (ยังไม่ได้รันอะไรบนเครื่องจริง — บอสเอาไปใช้เองได้เลย)`;
  }
  return `ทำลาย sandbox ${id} แล้วครับ`;
}

export function createUltronAgent(deps: UltronAgentDeps = {}): AgentDefinition {
  const settings = deps.settings ?? pcBridgeSettings;
  const createClient =
    deps.createClient ?? ((config: PcBridgeConfig) => new MemoryBusClient(config));
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const waitMs = deps.waitMs ?? 8_000;
  const pollMs = deps.pollMs ?? 1_000;
  // สร้างตอนใช้ — test ที่ไม่เรียก LLM ไม่ต้องโหลด orchestrator
  const llm = () => deps.llm ?? orchestratorLLM();

  async function runCode(client: BusClient, task: string) {
    let code: string;
    try {
      code = extractCode(
        await llm().chat([
          { role: 'system', content: ULTRON_CODE_PROMPT },
          { role: 'user', content: task },
        ]),
      );
    } catch (e) {
      // LLM ล้ม = ปัญหาเดียวกับแชท → ให้ AgentHandler/บอสเห็นข้อความเดิมของ provider
      return {
        reply: `อัลตรอนเขียนโค้ดไม่สำเร็จครับ — ${redactSecrets(e instanceof Error ? e.message : String(e))}`,
      };
    }
    if (!code) return { reply: 'อัลตรอนเขียนโค้ดไม่ออกครับ — ลองอธิบายงานให้ละเอียดขึ้น' };
    if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) {
      return { reply: `โค้ดที่ได้ยาวเกิน ${MAX_CODE_BYTES / 1000} KB ครับ — ลองแบ่งงานให้เล็กลง` };
    }
    try {
      const id = await client.submitTask('ULTRON_RUN', {
        task: task.slice(0, 500),
        language: 'python',
        code,
      });
      return {
        reply: `ส่งให้อัลตรอนรันใน sandbox แล้วครับ (รหัส ${shortId(id)}) — รันเสร็จ Mark 55 จะแจ้งผลกลับมา แล้วค่อยสั่ง "ปลด" หรือ "ทำลาย"`,
      };
    } catch (e) {
      return { reply: `ส่งงานให้อัลตรอนไม่สำเร็จ — ${failureAdvice(e)}` };
    }
  }

  async function decide(client: BusClient, text: string) {
    const { instruction, ref } = parseDecision(text);
    let taskId: string;
    try {
      taskId = await client.submitTask(instruction, { sandbox_id: ref });
    } catch (e) {
      return { reply: `ส่งคำสั่งให้อัลตรอนไม่สำเร็จ — ${failureAdvice(e)}` };
    }
    try {
      for (let waited = 0; waited < waitMs; waited += pollMs) {
        await sleep(pollMs);
        const task = await client.getTask(taskId);
        if (task && (task.status === 'COMPLETED' || task.status === 'FAILED'))
          return { reply: describeDecision(task) };
      }
    } catch (e) {
      return { reply: `ส่งคำสั่งแล้ว แต่อ่านผลไม่ได้ — ${failureAdvice(e)}` };
    }
    return {
      reply:
        'ส่งคำสั่งให้อัลตรอนแล้วครับ · Mark 55 ยังไม่ตอบ (อาจปิดเครื่องอยู่) — เปิดเมื่อไหร่จะทำต่อให้เอง',
    };
  }

  return {
    id: ULTRON_AGENT_ID,
    name: 'อัลตรอน',
    description: 'เขียนโค้ดแล้วรันใน sandbox บน Mark 55 — บอสสั่ง "ปลด" หรือ "ทำลาย" ทีหลัง',
    capabilities: [
      {
        id: 'ultron.run',
        label: 'รันงานใน sandbox',
        patterns: [
          new RegExp(
            String.raw`^(?:ให้\s*)?อัลตรอน\s*(?:ช่วย\s*)?(?:ทำ|เขียนโค้ด|รัน|ลอง)(?:ให้)?(?:หน่อย)?\s*(?:ว่า|:)\s*(?<command>\S[\s\S]*)$`,
          ),
          new RegExp(
            String.raw`^(?:ให้\s*)?(?:อัลตรอน\s*)?(?:ช่วย\s*)?(?:ทำ|รัน|ลอง|ทดลอง|เขียนโค้ด)\s*(?:ใน\s*)?${SANDBOX}\s*(?:ว่า|:)\s*(?<command>\S[\s\S]*)$`,
            'i',
          ),
          /^sandbox\s*:\s*(?<command>\S[\s\S]*)$/i,
        ],
        examples: [
          'อัลตรอน ทำว่า สุ่มเลขลอตเตอรี่ 6 หลัก 5 ชุด',
          'รันในแซนด์บ็อกซ์ว่า คำนวณดอกเบี้ยทบต้น 5 ปี',
        ],
      },
      {
        id: 'ultron.decide',
        label: 'ปลด / ทำลาย sandbox',
        patterns: [
          new RegExp(
            String.raw`^(?:อัลตรอน\s*)?(?<command>(?:ปลด|ทำลาย)\s*${SANDBOX}?\s*(?:[0-9a-f]{4,8})?)${TAIL}`,
            'i',
          ),
          /^(?<command>(?:release|destroy)\s+sandbox(?:\s+[0-9a-f]{4,8})?)$/i,
        ],
        examples: ['ปลด', 'ทำลาย', 'ปลด sandbox 1a2b'],
      },
    ],
    async run({ commandText, capabilityId }) {
      const config = await settings.load();
      if (!config) return { reply: NOT_CONFIGURED_REPLY };
      const client = createClient(config);
      return capabilityId === 'ultron.decide'
        ? decide(client, commandText)
        : runCode(client, commandText);
    },
  };
}

/** ลงทะเบียน agent อัลตรอน (เรียกซ้ำได้) */
export function registerUltronAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(ULTRON_AGENT_ID)) registry.register(createUltronAgent());
}
