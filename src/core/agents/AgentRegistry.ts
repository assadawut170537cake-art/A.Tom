/**
 * @file ทะเบียน agent (singleton `agentRegistry`) — ลงทะเบียน · ค้นหา · รันคำสั่ง · โหลด UI แบบ lazy
 *
 * - AgentClassifier อ่าน capability จาก {@link AgentRegistry.listCapabilities} เพื่อจับคู่ข้อความ
 * - AgentHandler เรียก {@link AgentRegistry.run}
 * - Agent Panel / AgentScreen เรียก {@link AgentRegistry.getScreenComponent} (โหลดครั้งเดียวแล้ว cache;
 *   โหลดล้ม → ไม่ cache เพื่อให้กด "ลองใหม่" แล้วโหลดใหม่ได้)
 *
 * ไม่มี agent ลงทะเบียน = classifier ไม่ match อะไรเลย → router ทำงานเหมือนก่อนมี agent
 */

import type { AgentCapability, AgentDefinition, AgentInfo, AgentRunInput, AgentRunResult, AgentScreenComponent } from './types';

const toInfo = (agent: AgentDefinition): AgentInfo => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  capabilities: agent.capabilities.map((c) => ({ id: c.id, label: c.label, examples: c.examples ?? [] })),
  hasScreen: typeof agent.loadScreen === 'function',
});

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  /** promise ของ UI ที่กำลังโหลด/โหลดแล้ว — ใช้ร่วมกันเมื่อหลายที่ขอพร้อมกัน */
  private readonly screens = new Map<string, Promise<AgentScreenComponent | null>>();

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`[agents] agent "${agent.id}" ลงทะเบียนไว้แล้ว`);
    }
    this.agents.set(agent.id, agent);
  }

  unregister(id: string): boolean {
    this.screens.delete(id);
    return this.agents.delete(id);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  /** metadata (ไม่มีฟังก์ชัน) — undefined ถ้าไม่มี agent นี้ */
  getAgent(id: string): AgentInfo | undefined {
    const agent = this.agents.get(id);
    return agent && toInfo(agent);
  }

  /** ตามลำดับที่ลงทะเบียน */
  list(): AgentInfo[] {
    return [...this.agents.values()].map(toInfo);
  }

  /** capability ทุกตัวของทุก agent ตามลำดับลงทะเบียน (agent แรก → capability แรก) */
  listCapabilities(): { agentId: string; capability: AgentCapability }[] {
    return [...this.agents.values()].flatMap((agent) =>
      agent.capabilities.map((capability) => ({ agentId: agent.id, capability }))
    );
  }

  /** throw เมื่อไม่มี agent นี้ หรือ agent เอง throw */
  async run(id: string, input: AgentRunInput): Promise<AgentRunResult> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`ไม่พบ agent "${id}"`);
    return agent.run(input);
  }

  /** UI ของ agent — null เมื่อไม่มี agent นี้หรือ agent ไม่มีหน้าจอ · reject เมื่อโหลดไม่สำเร็จ */
  getScreenComponent(id: string): Promise<AgentScreenComponent | null> {
    const cached = this.screens.get(id);
    if (cached) return cached;
    const load = this.agents.get(id)?.loadScreen;
    if (!load) return Promise.resolve(null);
    const pending = load().catch((e: unknown) => {
      // ไม่ cache ความล้มเหลว — ครั้งหน้าลองโหลดใหม่ได้ (เช่น bundle split โหลดไม่ทัน)
      if (this.screens.get(id) === pending) this.screens.delete(id);
      throw e;
    });
    this.screens.set(id, pending);
    return pending;
  }

  /** ล้างทุก agent (ใช้ใน test) */
  clear(): void {
    this.agents.clear();
    this.screens.clear();
  }
}

export const agentRegistry = new AgentRegistry();
