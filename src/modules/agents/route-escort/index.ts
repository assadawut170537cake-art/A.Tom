/**
 * @file Agent "หน่วยคุ้มกันเส้นทาง" (Route Escort) — คำนวณเส้นทางเลี่ยงจุดตรวจ/กล้อง ALPR/จุดรถติด
 *
 * | คำสั่ง                                          | ผล                                   |
 * |-------------------------------------------------|--------------------------------------|
 * | "เส้นทางเลี่ยงด่าน…" / "หาเส้นทางเลี่ยงกล้อง…"     | คำนวณเส้นทางเลี่ยง + เปิดหน้าแผนที่    |
 * | "สแกนกล้อง ALPR" / "สแกนด่านตรวจ"                | นับจุดตรวจ/กล้องในข้อมูลที่มี           |
 *
 * pattern ตั้งใจให้แคบ (ขึ้นต้นประโยค + คำเฉพาะ) เพราะ AgentClassifier มาก่อน Jev/LLM —
 * ประโยคคุยปกติอย่าง "เส้นทางนี้ไกลไหม" ต้องไม่โดน agent แย่งไป
 *
 * ข้อมูลจุดตรวจตอนนี้เป็นชุดจำลองแบบ offline (`FALLBACK_CHECKPOINTS`) และพิกัดต้น/ปลายทางเป็นค่าตัวอย่าง
 * TODO(phase-4.5): รับต้นทาง/ปลายทางจากข้อความ + ดึงข้อมูลจริง (OSM / DeFlock)
 */

import { agentRegistry, type AgentRegistry } from '../../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../../core/agents/types';
import { FALLBACK_CHECKPOINTS, type Checkpoint } from './checkpoints';
import { calculateAvoidanceRoute, DEMO_DESTINATION, DEMO_ORIGIN } from './routingEngine';

export const ROUTE_ESCORT_AGENT_ID = 'route-escort';

/** จุดที่ต้องสแกน/เลี่ยง — ไม่รวมจุดรถติด (ไม่ใช่กล้อง/ด่าน) */
const isSurveillance = (c: Checkpoint) => c.type === 'alpr' || c.type === 'checkpoint';

export function createRouteEscortAgent(checkpoints: readonly Checkpoint[] = FALLBACK_CHECKPOINTS): AgentDefinition {
  return {
    id: ROUTE_ESCORT_AGENT_ID,
    name: 'หน่วยคุ้มกันเส้นทาง',
    description: 'คำนวณเส้นทางเลี่ยงด่านตรวจ กล้อง ALPR และจุดรถติด',
    capabilities: [
      {
        id: 'route.avoid',
        label: 'หาเส้นทางเลี่ยงด่าน/กล้อง',
        patterns: [
          /^(?:ช่วย)?(?:หา|คำนวณ)?เส้นทางเลี่ยง(?:ด่านตรวจ|ด่าน|กล้อง|รถติด)?(?<command>[\s\S]*)$/,
          /^route\s+escort\s*:?\s*(?<command>[\s\S]*)$/i,
        ],
        examples: ['เส้นทางเลี่ยงด่านจากบ้านไปทำงาน', 'หาเส้นทางเลี่ยงกล้อง'],
      },
      {
        id: 'route.scan',
        label: 'สแกนกล้อง ALPR / ด่านตรวจ',
        patterns: [/^สแกน\s*(?:กล้อง\s*)?(?:alpr|ด่านตรวจ|ด่าน|กล้อง)(?<command>[\s\S]*)$/i, /^scan\s+(?:alpr|checkpoints?)(?<command>[\s\S]*)$/i],
        examples: ['สแกนกล้อง ALPR', 'สแกนด่านตรวจ'],
      },
    ],
    async run({ capabilityId }) {
      if (capabilityId === 'route.scan') {
        const found = checkpoints.filter(isSurveillance);
        return { reply: `พบกล้อง ALPR / ด่านตรวจ ${found.length} จุดในข้อมูลที่มีครับบอส`, showScreen: true };
      }
      const route = calculateAvoidanceRoute(DEMO_ORIGIN, DEMO_DESTINATION, checkpoints);
      return {
        reply:
          `คำนวณเส้นทางเลี่ยงแล้วครับ: เลี่ยง ${route.avoidedCheckpointsCount} จุด · ` +
          `ระยะ ${route.distanceKm.toFixed(2)} กม. · ประมาณ ${Math.round(route.durationMin)} นาที`,
        showScreen: true,
      };
    },
    // Metro ต้องการ import() แบบ string คงที่ → ใส่ path ตรง ๆ
    loadScreen: () => import('./RouteEscortScreen').then((m) => m.RouteEscortScreen),
  };
}

/** ลงทะเบียน agent (เรียกซ้ำได้ — fast refresh / bootApp ซ้ำ) */
export function registerRouteEscortAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(ROUTE_ESCORT_AGENT_ID)) registry.register(createRouteEscortAgent());
}
