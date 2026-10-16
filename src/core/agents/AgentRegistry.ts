// src/core/agents/AgentRegistry.ts

import { AtomAgent, AgentId, AgentScreenProps } from './types';
import React from 'react';

interface AgentEntry {
  agent: AtomAgent;
  state: 'registered' | 'ready' | 'failed';
  error?: string;
  screenComponent?: React.ComponentType<AgentScreenProps>;
  screenLoadPromise?: Promise<React.ComponentType<AgentScreenProps>>;
}

export class AgentRegistry {
  private readonly entries = new Map<AgentId, AgentEntry>();

  /** ลงทะเบียนเอเจน (เก็บเฉพาะ Metadata แขวนไว้ก่อน ยังไม่โหลดโค้ดจริงทั้งหมด) */
  register(agent: AtomAgent): void {
    if (this.entries.has(agent.id)) {
      throw new Error(`[AgentRegistry] เอเจน "${agent.id}" มีการลงทะเบียนซ้ำซ้อน`);
    }
    this.entries.set(agent.id, {
      agent,
      state: 'registered',
    });
  }

  get(id: AgentId): AtomAgent | undefined {
    return this.entries.get(id)?.agent;
  }

  listEnabled(): AtomAgent[] {
    return [...this.entries.values()]
      .filter((e) => e.agent.enabled && e.state !== 'failed')
      .map((e) => e.agent);
  }

  /** โหลดหน้าจอ UI ของเอเจนเฉพาะตอนจะใช้งานจริงเท่านั้น (Lazy-Load) */
  async getScreenComponent(id: AgentId): Promise<React.ComponentType<AgentScreenProps> | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.screenComponent) return entry.screenComponent;
    if (!entry.agent.getScreenComponent) return undefined;

    if (!entry.screenLoadPromise) {
      entry.screenLoadPromise = (async () => {
        try {
          const Comp = await entry.agent.getScreenComponent!();
          entry.screenComponent = Comp;
          entry.state = 'ready';
          return Comp;
        } catch (e) {
          entry.state = 'failed';
          entry.error = e instanceof Error ? e.message : String(e);
          console.error(`[AgentRegistry] โหลดหน้าจอ UI ของเอเจน "${id}" พัง:`, e);
          throw e;
        }
      })();
    }
    return entry.screenLoadPromise;
  }
}

/** Singleton registry ใช้ทั่วแอป — ลงทะเบียนเอเจนตอนบูต แล้วค้นหาตอน route */
export const agentRegistry = new AgentRegistry();
