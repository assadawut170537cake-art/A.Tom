/**
 * @file Agent "NotebookLM" — ส่งลิงก์ / YouTube / ข้อความ เข้า NotebookLM Enterprise ผ่าน Mark 55 (Boss เลือกทาง A · 2026-10-20)
 *
 * | คำสั่ง                                               | ทำอะไร                                       |
 * |------------------------------------------------------|----------------------------------------------|
 * | "ส่งเข้า NotebookLM: <ลิงก์/ข้อความ>"                  | ใส่ใน notebook เดิม (ครั้งแรก Mark 55 สร้างให้) |
 * | "ส่งเข้า NotebookLM ใหม่ ชื่อ วิจัย AI: <ลิงก์/ข้อความ>" | สร้าง notebook ใหม่ชื่อนั้นแล้วใส่              |
 *
 * ทำไมผ่าน PC: API ของ NotebookLM Enterprise ใช้ OAuth token ไม่ใช่ API key → PC ใช้ gcloud ที่ล็อกอินไว้
 * (`mark55/notebooklm.py` · SQL `mark55/sql/005_notebooklm.sql`) · มือถือไม่เก็บ token
 * ไฟล์ที่แนบด้วยปุ่ม + ยังส่งเข้า NotebookLM ไม่ได้ (Bus รับ payload ≤ 16 KB) — ใช้ลิงก์ หรือวางข้อความแทน
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import { NOTEBOOKLM_PREFIX } from '../../features/attachments/prefills';
import { MemoryBusClient } from '../../features/pc-bridge/MemoryBusClient';
import {
  failureAdvice,
  NOT_CONFIGURED_REPLY,
  type BusClient,
} from '../../features/pc-bridge/PcBridgeModule';
import {
  pcBridgeSettings,
  type PcBridgeConfig,
  type PcBridgeSettingsStore,
} from '../../features/pc-bridge/settings';

export const NOTEBOOKLM_AGENT_ID = 'notebooklm';
export { NOTEBOOKLM_PREFIX };
/** ตรงกับ payload 16 KB ของ mobile_submit_task (เผื่อ JSON + escape ภาษาไทย) */
export const MAX_NOTEBOOK_TEXT = 4_000;

export interface NotebookSource {
  type: 'url' | 'youtube' | 'text';
  value: string;
  name?: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const YOUTUBE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

/** ": ลิงก์ ข้อความ" / "ใหม่ ชื่อ X: …" → ชื่อ notebook ใหม่ (ถ้ามี) + รายการ source */
export function parseNotebookCommand(command: string): {
  title: string;
  sources: NotebookSource[];
} {
  const sep = command.search(/[:：]/);
  const head = sep >= 0 ? command.slice(0, sep) : '';
  const body = (sep >= 0 ? command.slice(sep + 1) : command).trim();
  const title = /ใหม่/.test(head)
    ? head.replace(/^\s*ใหม่\s*(?:ชื่อ)?\s*/, '').trim() || 'A.T.O.M.'
    : '';
  const urls = body.match(URL_RE) ?? [];
  const sources: NotebookSource[] = urls.map((url) => ({
    type: YOUTUBE.test(url) ? 'youtube' : 'url',
    value: url.replace(/[).,]+$/, ''),
  }));
  const text = body.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (text.length >= 2) {
    sources.push({
      type: 'text',
      value: text.slice(0, MAX_NOTEBOOK_TEXT),
      name: text.slice(0, 40),
    });
  }
  return { title, sources };
}

export interface NotebookLMAgentDeps {
  settings?: Pick<PcBridgeSettingsStore, 'load'> | undefined;
  createClient?: ((config: PcBridgeConfig) => BusClient) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  waitMs?: number | undefined;
  pollMs?: number | undefined;
}

export function createNotebookLMAgent(deps: NotebookLMAgentDeps = {}): AgentDefinition {
  const settings = deps.settings ?? pcBridgeSettings;
  const createClient =
    deps.createClient ?? ((config: PcBridgeConfig) => new MemoryBusClient(config));
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const waitMs = deps.waitMs ?? 12_000; // gcloud + สร้าง notebook ช้ากว่างานอื่น
  const pollMs = deps.pollMs ?? 1_000;

  return {
    id: NOTEBOOKLM_AGENT_ID,
    name: 'NotebookLM',
    description: 'ส่งลิงก์ / YouTube / ข้อความ เข้า NotebookLM Enterprise ผ่าน Mark 55',
    capabilities: [
      {
        id: 'notebooklm.add',
        label: 'ส่งเข้า NotebookLM',
        patterns: [
          /^(?:ส่ง|ใส่|เอา)\s*(?:เข้า|ไป|ลง)?\s*(?:notebook\s*lm|โน้ตบุ๊ก\s*(?:แอลเอ็ม)?)\s*(?<command>(?:ใหม่[^:：\n]*)?[:：][\s\S]*\S[\s\S]*)$/i,
        ],
        examples: [
          'ส่งเข้า NotebookLM: https://example.com/article',
          'ส่งเข้า NotebookLM ใหม่ ชื่อ วิจัย AI: https://youtu.be/xxxx',
        ],
      },
    ],
    async run({ commandText }) {
      const { title, sources } = parseNotebookCommand(commandText);
      if (!sources.length) {
        return {
          reply:
            'ยังไม่มีลิงก์หรือข้อความให้ส่งครับ — พิมพ์ต่อท้าย เช่น "ส่งเข้า NotebookLM: https://…"',
        };
      }
      const config = await settings.load();
      if (!config) return { reply: NOT_CONFIGURED_REPLY };
      const client = createClient(config);
      let taskId: string;
      try {
        taskId = await client.submitTask('NOTEBOOKLM_ADD', { sources, ...(title && { title }) });
      } catch (e) {
        return { reply: `ส่งงานเข้า NotebookLM ไม่สำเร็จ — ${failureAdvice(e)}` };
      }
      try {
        for (let waited = 0; waited < waitMs; waited += pollMs) {
          await sleep(pollMs);
          const task = await client.getTask(taskId);
          if (!task || (task.status !== 'COMPLETED' && task.status !== 'FAILED')) continue;
          const { result } = task;
          if (result.status === 'ADDED' && typeof result.message === 'string') {
            return { reply: result.message };
          }
          const reason = typeof result.error === 'string' ? result.error : JSON.stringify(result);
          return { reply: `NotebookLM ใส่ไม่ได้ครับ — ${reason}` };
        }
      } catch (e) {
        return { reply: `ส่งแล้ว แต่อ่านผลไม่ได้ — ${failureAdvice(e)}` };
      }
      return {
        reply: `ส่ง ${sources.length} รายการให้ Mark 55 แล้วครับ · ยังไม่ตอบ (คอมอาจปิดอยู่) — เปิดเมื่อไหร่จะใส่ NotebookLM ให้เอง`,
      };
    },
  };
}

/** ลงทะเบียน agent NotebookLM (เรียกซ้ำได้) */
export function registerNotebookLMAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(NOTEBOOKLM_AGENT_ID)) registry.register(createNotebookLMAgent());
}
