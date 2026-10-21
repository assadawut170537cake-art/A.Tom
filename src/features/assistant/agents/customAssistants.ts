/**
 * @file ผู้ช่วยที่ผู้ใช้สร้างเอง ("สร้างผู้ช่วยชื่อ นักแปล ที่แปลไทย↔อังกฤษ") แล้วเรียกใช้ด้วยชื่อ ("ให้นักแปลช่วยแปลว่า …")
 *
 * ออกแบบเป็น "ผู้ช่วยเฉพาะทางแบบเรียกทีละคำสั่ง" วางทับ 4 persona หลัก (อะตอม/จาร์วิส/ไฟรเดย์/อัลตรอน) แทนการเพิ่ม persona ตัวที่ 5+
 * (persona id 1–4 ถูกใช้เป็นกุญแจใน storage/เสียง/Orb ทั่วแอป) — เสียงที่พูดตอบยังเป็นเสียงของ persona ที่คุยอยู่
 * เก็บใน AsyncStorage (`atom.assistants.v1`) · pattern เรียกใช้สร้างจากชื่อที่มีอยู่จริง (อ่านใหม่ทุกครั้งที่ router ถาม)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AgentCapability, AgentDefinition } from '../../../core/agents/types';
import { readJSON, writeJSON } from '../../../core/storage/jsonStorage';
import { isArrayOf, isRecord } from '../../../core/types/guards';
import { aiOrchestrator } from '../../ai/core/Orchestrator';
import { AssistantError } from '../shared/errors';
import { appLlm, extractJson, str, type Llm } from '../shared/llm';

export const CUSTOM_ASSISTANTS_AGENT_ID = 'custom-assistants';
export const CUSTOM_ASSISTANTS_KEY = 'atom.assistants.v1';
export const MAX_ASSISTANTS = 12;
const RESERVED = /^(?:อะตอม|จาร์วิส|จาวิส|ไฟรเดย์|ฟรายเดย์|อัลตรอน|atom|jarvis|friday|ultron)$/i;

export interface CustomAssistant {
  name: string;
  prompt: string;
  createdAt: number;
}

const isAssistant = (v: unknown): v is CustomAssistant =>
  isRecord(v) &&
  typeof v.name === 'string' &&
  typeof v.prompt === 'string' &&
  typeof v.createdAt === 'number';

export class AssistantStore {
  private items: CustomAssistant[] = [];

  constructor(
    private readonly key: string = CUSTOM_ASSISTANTS_KEY,
    private readonly storage = AsyncStorage,
  ) {}

  /** อ่านจาก storage เข้า cache (เรียกตอนเปิดแอป) */
  async load(): Promise<void> {
    void this.storage;
    this.items =
      (await readJSON(this.key, (v): v is CustomAssistant[] => isArrayOf(v, isAssistant))) ?? [];
  }

  /** sync (จาก cache) — ใช้สร้าง pattern */
  list(): readonly CustomAssistant[] {
    return this.items;
  }

  find(name: string): CustomAssistant | undefined {
    const n = name.trim().toLowerCase();
    return this.items.find((a) => a.name.toLowerCase() === n);
  }

  async add(
    assistant: Omit<CustomAssistant, 'createdAt'>,
    now = Date.now(),
  ): Promise<CustomAssistant> {
    const name = assistant.name.trim();
    if (!name || name.length > 24) throw new AssistantError('ชื่อผู้ช่วยต้องยาว 1–24 ตัวอักษรครับ');
    if (RESERVED.test(name))
      throw new AssistantError(`“${name}” เป็นชื่อผู้ช่วยหลักอยู่แล้ว ตั้งชื่ออื่นนะครับ`);
    if (this.find(name)) throw new AssistantError(`มีผู้ช่วยชื่อ “${name}” อยู่แล้วครับ`);
    if (this.items.length >= MAX_ASSISTANTS)
      throw new AssistantError(`สร้างได้สูงสุด ${MAX_ASSISTANTS} ตัวครับ — ลบตัวเก่าก่อน`);
    const created: CustomAssistant = { name, prompt: assistant.prompt.trim(), createdAt: now };
    this.items = [...this.items, created];
    await writeJSON(this.key, this.items);
    return created;
  }

  async remove(name: string): Promise<boolean> {
    const found = this.find(name);
    if (!found) return false;
    this.items = this.items.filter((a) => a !== found);
    await writeJSON(this.key, this.items);
    return true;
  }
}

export const assistantStore = new AssistantStore();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** pattern เรียกใช้ผู้ช่วยตามชื่อที่มีอยู่ตอนนี้ ("ให้นักแปลช่วยแปลว่า …" / "นักแปล: …") */
export function invokePatterns(names: readonly string[]): RegExp[] {
  if (names.length === 0) return [];
  const alt = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return [
    new RegExp(
      `^(?:ให้|เรียก|ถาม|ส่งต่อให้)\\s*(?<who>${alt})\\s*(?:ช่วย|ตอบ|ว่า|:)?\\s*(?<command>.{2,})$`,
      'i',
    ),
    new RegExp(`^(?<who>${alt})\\s*[:：]\\s*(?<command>.{2,})$`, 'i'),
  ];
}

export interface CustomAssistantsDeps {
  store?: AssistantStore;
  llm?: Llm;
  /** ตอบในบทบาทของผู้ช่วย — ค่าเริ่มต้นเรียก aiOrchestrator */
  respond?: (prompt: string, request: string) => Promise<string>;
}

const defaultRespond = async (prompt: string, request: string): Promise<string> =>
  (
    await aiOrchestrator.chat({
      messages: [
        {
          role: 'system',
          content: `${prompt}\nตอบเป็นภาษาไทยเป็นหลัก สั้น กระชับ เหมาะอ่านออกเสียง`,
        },
        { role: 'user', content: request },
      ],
    })
  ).content.trim();

export function createCustomAssistantsAgent(deps: CustomAssistantsDeps = {}): AgentDefinition {
  const store = deps.store ?? assistantStore;
  const llm = deps.llm ?? appLlm;
  const respond = deps.respond ?? defaultRespond;

  const fixed: AgentCapability[] = [
    {
      id: 'assistant.create',
      label: 'สร้างผู้ช่วยใหม่',
      patterns: [/^(?:ช่วย)?(?:สร้าง|เพิ่ม)ผู้ช่วย(?:ใหม่)?(?:ชื่อ)?\s*(?<command>.{3,})$/],
      examples: ['สร้างผู้ช่วยชื่อ นักแปล ที่แปลไทยเป็นอังกฤษให้สุภาพ'],
    },
    {
      id: 'assistant.list',
      label: 'ดูผู้ช่วยของฉัน',
      patterns: [/^(?:ดู|มี)ผู้ช่วย(?:อะไร)?(?:ของฉัน|ทั้งหมด|บ้าง)$/],
      examples: ['มีผู้ช่วยอะไรบ้าง'],
    },
    {
      id: 'assistant.delete',
      label: 'ลบผู้ช่วย',
      patterns: [/^ลบผู้ช่วย\s*(?<command>.+)$/],
      examples: ['ลบผู้ช่วย นักแปล'],
    },
  ];

  return {
    id: CUSTOM_ASSISTANTS_AGENT_ID,
    name: 'ผู้ช่วยของฉัน',
    description: 'สร้างและเรียกใช้ผู้ช่วยเฉพาะทางที่กำหนดบทบาทเอง',
    // getter: อ่านชื่อล่าสุดทุกครั้งที่ router ถาม (สร้าง/ลบแล้วมีผลทันที)
    get capabilities(): readonly AgentCapability[] {
      const use = invokePatterns(store.list().map((a) => a.name));
      return use.length
        ? [
            ...fixed,
            {
              id: 'assistant.use',
              label: 'เรียกใช้ผู้ช่วย',
              patterns: use,
              examples: ['ให้นักแปลช่วยแปลว่า สวัสดีตอนเช้า'],
            },
          ]
        : fixed;
    },
    async run({ text, commandText, capabilityId }) {
      if (capabilityId === 'assistant.list') {
        const names = store.list().map((a) => a.name);
        return {
          reply: names.length
            ? `ผู้ช่วยของคุณ: ${names.join(', ')}`
            : 'ยังไม่ได้สร้างผู้ช่วยเลยครับ — ลองพูดว่า “สร้างผู้ช่วยชื่อ …”',
        };
      }
      if (capabilityId === 'assistant.delete') {
        return {
          reply: (await store.remove(commandText))
            ? `ลบผู้ช่วย “${commandText.trim()}” แล้วครับ`
            : `ไม่พบผู้ช่วยชื่อ “${commandText.trim()}” ครับ`,
        };
      }
      if (capabilityId === 'assistant.create') {
        const draft = await extractJson(
          llm,
          'แปลงคำอธิบายเป็นผู้ช่วยเฉพาะทาง: name = ชื่อสั้น ๆ (ไม่เกิน 24 ตัวอักษร) ตามที่ผู้ใช้ตั้ง, prompt = คำสั่งระบบภาษาไทย 2–4 ประโยค ระบุบทบาท ขอบเขต และสไตล์การตอบ',
          '{"name":"ชื่อ","prompt":"คำสั่งระบบ"}',
          commandText,
          (v) => {
            const name = str(v.name);
            const prompt = str(v.prompt);
            return name && prompt ? { name, prompt } : null;
          },
        );
        const created = await store.add(draft);
        return {
          reply: `สร้างผู้ช่วย “${created.name}” แล้วครับ เรียกใช้ได้โดยพูดว่า “ให้${created.name}ช่วย …”`,
        };
      }
      // assistant.use — หาว่าเป็นตัวไหนจากชื่อที่ปรากฏในประโยค
      const who = [...store.list()]
        .sort((a, b) => b.name.length - a.name.length)
        .find((a) => text.toLowerCase().includes(a.name.toLowerCase()));
      if (!who) throw new AssistantError('ไม่พบผู้ช่วยที่เรียกครับ');
      const reply = await respond(who.prompt, commandText);
      if (!reply) throw new AssistantError(`${who.name}ไม่ได้ตอบกลับมาครับ`);
      return { reply };
    },
  };
}
