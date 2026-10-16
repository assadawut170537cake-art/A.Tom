// src/features/router/classifiers/AgentClassifier.ts

import { agentRegistry } from '../../../core/agents/AgentRegistry';
import type { Classifier, RouterInput, RouterOutput } from '../core/types';
import { routeFor } from './routeFor';

/**
 * AgentClassifier — จับคู่คำสั่งของบอสกับเอเจนที่ลงทะเบียนไว้
 *
 * ตรวจดูทุก capability ของเอเจนที่เปิดอยู่ว่าตรงกับข้อความหรือไม่
 * (match จาก intent, description, หรือ example) ถ้าเจอคืน route intent 'agent'
 * ให้ AgentHandler นำไปสั่งงานผ่าน AgentBroker ต่อไป
 *
 * ถ้าไม่มีเอเจนใดตรง คืน null ให้ classifier ถัดไปตัดสินใจแทน
 */
export class AgentClassifier implements Classifier {
  constructor(private readonly registry = agentRegistry) {}

  async classify(input: RouterInput): Promise<RouterOutput | null> {
    const text = input.text.toLowerCase().trim();
    if (!text) return null;

    const agents = this.registry.listEnabled();
    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        const patterns = [cap.intent, cap.description, cap.example?.toLowerCase()].filter(Boolean);
        if (patterns.some((p): p is string => !!p && text.includes(p.toLowerCase()))) {
          return routeFor(
            'agent',
            0.85,
            'rule',
            input.text
          ) as RouterOutput & {
            entities: { agentId: string; commandText: string };
          };
        }
      }
    }
    return null;
  }
}
