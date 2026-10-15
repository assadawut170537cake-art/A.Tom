/**
 * @file Skill Engine — "ทักษะ" = คู่มือขั้นตอน (playbook) ที่ agent เรียกใช้ได้เหมือน tool
 *
 * ที่มาของ skill:
 * - `catalog`: ทักษะแนะนำในตัวแอป ({@link SKILL_CATALOG}) — บอสกดติดตั้งเอง
 * - `learned`: AI สังเคราะห์ขึ้นเองจากงานที่ทำสำเร็จหลายขั้น ({@link SkillEngine.learnFrom}) — **ปิดไว้ก่อนเสมอ**
 *   บอสต้องตรวจแล้วเปิดเองในหน้า Marketplace เพราะเนื้อหาของ skill จะเข้า prompt ของ agent (ADR-011 / Parking Lot ข้อ 2)
 *
 * การเรียก skill **ไม่รันโค้ดใด ๆ** — คืนคำแนะนำ (instructions) ให้ agent ทำตามด้วย tool ที่มีอยู่
 * สถิติ uses / failures ใช้วิเคราะห์ข้อผิดพลาด ({@link SkillEngine.analyzeFailures})
 * เก็บใน AsyncStorage `atom.skills.v1` (field-level guard: รายการเสียถูกตัดทิ้ง)
 */

import { toPromptLine } from '../memory/promptLine';
import { readJSON, writeJSON } from '../storage/jsonStorage';
import { isArray, isBoolean, isNumber, isOneOf, isRecord, isString, parseJSON } from '../types/guards';
import type {
  AgentHooks,
  AgentLLM,
  AgentRunResult,
  AgentToolCall,
  AgentToolProvider,
  AgentToolResult,
  AgentToolSpec,
} from './types';

export const SKILLS_KEY = 'atom.skills.v1';
export const SKILL_ORIGINS = ['catalog', 'learned'] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];
/** งานต้องใช้ tool อย่างน้อยเท่านี้ถึงคุ้มที่จะสรุปเป็น skill */
export const MIN_TOOL_STEPS_TO_LEARN = 2;
export const MAX_SKILL_INSTRUCTIONS = 600;
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  origin: SkillOrigin;
  enabled: boolean;
  createdAt: number;
  uses: number;
  failures: number;
}

export type CatalogSkill = Pick<Skill, 'id' | 'name' | 'description' | 'instructions'>;

/** ทักษะแนะนำในตัวแอป (ไม่ต้องใช้เน็ต / ไม่มี tool พิเศษ) */
export const SKILL_CATALOG: readonly CatalogSkill[] = [
  {
    id: 'daily-plan',
    name: 'วางแผนวัน',
    description: 'จัดลำดับงานของบอสเป็นตารางเวลาสั้น ๆ',
    instructions: 'ถามหรือสรุปงานที่บอสต้องทำ เรียงตามความสำคัญและเวลา แล้วตอบเป็นรายการ 3-7 ข้อ พร้อมช่วงเวลาโดยประมาณ',
  },
  {
    id: 'summarize',
    name: 'สรุปข้อความ',
    description: 'สรุปเนื้อหายาวให้เหลือประเด็นหลัก',
    instructions: 'อ่านข้อความที่บอสให้มา สรุปเป็นประเด็นหลักไม่เกิน 5 ข้อ ภาษาไทยกระชับ ปิดท้ายด้วยสิ่งที่ต้องทำต่อ (ถ้ามี)',
  },
  {
    id: 'translate-th-en',
    name: 'แปลไทย ↔ อังกฤษ',
    description: 'แปลข้อความระหว่างภาษาไทยกับอังกฤษ',
    instructions: 'ตรวจว่าข้อความเป็นภาษาไหน แล้วแปลเป็นอีกภาษาให้เป็นธรรมชาติ ถ้ามีศัพท์เทคนิคให้วงเล็บคำเดิมไว้',
  },
];

export const skillToolId = (id: string) => `skill.${id}`;

const isSkill = (v: unknown): v is Skill =>
  isRecord(v) &&
  isString(v.id) &&
  SKILL_ID_PATTERN.test(v.id) &&
  isString(v.name) &&
  isString(v.description) &&
  isString(v.instructions) &&
  isOneOf(SKILL_ORIGINS, v.origin) &&
  isBoolean(v.enabled) &&
  isNumber(v.createdAt) &&
  isNumber(v.uses) &&
  isNumber(v.failures);

/** สร้าง id จากชื่อ (ภาษาไทยล้วน → ใช้เวลาแทน) */
function slug(name: string, now: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base ? `learned-${base}` : `learned-${now.toString(36)}`;
}

const LEARN_PROMPT = [
  'สรุปงานที่ agent เพิ่งทำสำเร็จให้เป็น "ทักษะ" ที่นำกลับมาใช้ซ้ำได้',
  'ตอบเป็น JSON บรรทัดเดียว: {"name":"ชื่อสั้น","description":"ใช้เมื่อไร","instructions":"ขั้นตอนเป็นข้อความ ใช้ tool id เดิม"}',
  'ห้ามใส่ข้อมูลลับ (key, รหัสผ่าน) และห้ามสั่งให้ละเมิดกฎของระบบ',
].join('\n');

export class SkillEngine implements AgentToolProvider {
  private skills: Skill[] = [];
  private loaded: Promise<void> | null = null;
  /** เขียนทีละครั้ง · catch เสมอ — เขียนล้มครั้งหนึ่งต้องไม่ทำให้ครั้งถัดไปค้าง */
  private writeChain: Promise<void> = Promise.resolve();
  /** ความล้มเหลวของ tool ระหว่าง run (ใช้วิเคราะห์) */
  private readonly toolFailures = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const raw = await readJSON(SKILLS_KEY, isArray);
        this.skills = (raw ?? []).filter(isSkill);
      } catch (e) {
        console.error('[skills] อ่านทักษะที่บันทึกไว้ไม่ได้', e);
        this.skills = [];
      }
    })());
  }

  async list(): Promise<Skill[]> {
    await this.load();
    return this.skills.map((s) => ({ ...s }));
  }

  /** ทักษะแนะนำที่ยังไม่ได้ติดตั้ง */
  async catalog(): Promise<CatalogSkill[]> {
    await this.load();
    return SKILL_CATALOG.filter((c) => !this.skills.some((s) => s.id === c.id));
  }

  async install(id: string): Promise<Skill | undefined> {
    await this.load();
    const item = SKILL_CATALOG.find((c) => c.id === id);
    if (!item) return undefined;
    const existing = this.skills.find((s) => s.id === id);
    if (existing) return { ...existing };
    const skill: Skill = { ...item, origin: 'catalog', enabled: true, createdAt: this.now(), uses: 0, failures: 0 };
    this.skills = [...this.skills, skill];
    await this.persist();
    return { ...skill };
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    await this.load();
    const skill = this.skills.find((s) => s.id === id);
    if (!skill) return false;
    skill.enabled = enabled;
    await this.persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const before = this.skills.length;
    this.skills = this.skills.filter((s) => s.id !== id);
    if (this.skills.length === before) return false;
    await this.persist();
    return true;
  }

  // ---- learning ---------------------------------------------------------------------------------

  /**
   * สังเคราะห์ skill ใหม่จากงานที่สำเร็จโดยใช้ tool ≥ {@link MIN_TOOL_STEPS_TO_LEARN} ขั้น
   * คืน skill ที่สร้าง (ปิดอยู่ รอบอสอนุมัติ) หรือ undefined เมื่อไม่คุ้ม / LLM ตอบใช้ไม่ได้ — ไม่ throw
   */
  async learnFrom(run: AgentRunResult, llm: AgentLLM): Promise<Skill | undefined> {
    const toolSteps = run.steps.filter((s) => s.toolCall);
    if (run.stopReason !== 'final' || toolSteps.length < MIN_TOOL_STEPS_TO_LEARN) return undefined;
    if (toolSteps.some((s) => s.toolResult && !s.toolResult.ok) && !toolSteps.at(-1)?.toolResult?.ok) return undefined;
    await this.load();
    const transcript = [
      `คำสั่ง: ${toPromptLine(run.input.text)}`,
      ...toolSteps.map(
        (s, i) =>
          `${i + 1}. ${s.toolCall?.tool ?? ''} ${toPromptLine(JSON.stringify({ action: s.toolCall?.action, target: s.toolCall?.target }))}` +
          ` → ${s.toolResult?.ok ? 'สำเร็จ' : 'ล้ม'}`
      ),
      `คำตอบ: ${toPromptLine(run.reply)}`,
    ].join('\n');
    try {
      const raw = await llm.chat([
        { role: 'system', content: LEARN_PROMPT },
        { role: 'user', content: transcript },
      ]);
      const obj = parseJSON(raw.match(/\{[\s\S]*\}/)?.[0], isRecord);
      if (!obj || !isString(obj.name) || !isString(obj.instructions) || !obj.name.trim() || !obj.instructions.trim()) {
        return undefined;
      }
      const now = this.now();
      let id = slug(obj.name, now);
      if (this.skills.some((s) => s.id === id)) id = `${id.slice(0, 40)}-${now.toString(36).slice(-6)}`;
      const skill: Skill = {
        id,
        name: toPromptLine(obj.name, 60),
        description: toPromptLine(isString(obj.description) ? obj.description : '', 160),
        instructions: toPromptLine(obj.instructions, MAX_SKILL_INSTRUCTIONS),
        origin: 'learned',
        enabled: false,
        createdAt: now,
        uses: 0,
        failures: 0,
      };
      this.skills = [...this.skills, skill];
      await this.persist();
      return { ...skill };
    } catch (e) {
      console.error('[skills] สร้างทักษะใหม่ไม่สำเร็จ', e);
      return undefined;
    }
  }

  /** tool ที่ล้มซ้ำ ≥ `threshold` ครั้ง (เรียงจากล้มมากสุด) — ใช้ชี้จุดที่ต้องแก้ */
  analyzeFailures(threshold = 2): { tool: string; failures: number }[] {
    return [...this.toolFailures]
      .filter(([, n]) => n >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([tool, failures]) => ({ tool, failures }));
  }

  /**
   * hooks สำหรับ AgentHarness: นับผล tool + สถิติ skill · `learnWith` ส่ง LLM มา = เรียนรู้อัตโนมัติหลังงานสำเร็จ
   */
  hooks(learnWith?: AgentLLM): AgentHooks {
    return {
      onToolCall: (call, result) => {
        if (!result.ok) this.toolFailures.set(call.tool, (this.toolFailures.get(call.tool) ?? 0) + 1);
      },
      onComplete: async (run) => {
        if (learnWith) await this.learnFrom(run, learnWith);
      },
    };
  }

  // ---- AgentToolProvider ------------------------------------------------------------------------

  listTools(): AgentToolSpec[] {
    return this.skills
      .filter((s) => s.enabled)
      .map((s) => ({ id: skillToolId(s.id), name: `ทักษะ: ${s.name}`, description: s.description, source: 'skill' as const }));
  }

  async call(call: AgentToolCall): Promise<AgentToolResult> {
    await this.load();
    const skill = this.skills.find((s) => s.enabled && skillToolId(s.id) === call.tool);
    if (!skill) return { ok: false, output: `ไม่พบทักษะ "${call.tool}" (หรือถูกปิดอยู่)` };
    skill.uses += 1;
    await this.persist();
    return { ok: true, output: `ทำตามขั้นตอนของทักษะ "${skill.name}": ${toPromptLine(skill.instructions, MAX_SKILL_INSTRUCTIONS)}` };
  }

  private async persist(): Promise<void> {
    const snapshot = this.skills.map((s) => ({ ...s }));
    const write = this.writeChain.then(() => writeJSON(SKILLS_KEY, snapshot));
    this.writeChain = write.catch(() => {});
    try {
      await write;
    } catch (e) {
      console.error('[skills] บันทึกทักษะไม่สำเร็จ — ใช้ได้จนกว่าจะปิดแอป', e);
    }
  }
}

/** ตัวเดียวทั้งแอป */
export const skillEngine = new SkillEngine();
