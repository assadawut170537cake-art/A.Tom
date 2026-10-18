// src/modules/agents/route-escort/index.ts
//
// RouteEscort agent (AgentDefinition) — หน่วยคุ้มกันเส้นทาง
//
// Capabilities:
//   - avoidance_navigation: คำนวณเส้นทางเลี่ยงด่านตรวจ/รถติด
//   - scan_surveillance:    สแกนจุดตรวจและกล้อง ALPR ในรัศมีเส้นทาง
//
// Executed via the existing AgentRegistry/AgentHandler pipeline (ไม่ใช่ AgentBroker)
// เพราะ intent ของ route-escort จับคู่ด้วย pattern ของ AgentClassifier
// ได้แล้ว เมื่อเปิดหน้าจอจะโหลด RouteEscortScreen แบบ lazy
//
// ลงทะเบียนใน boot() -> registerRouteEscortAgent()

import type { AgentDefinition } from '../../../core/agents/types';
import { agentRegistry } from '../../../core/agents/AgentRegistry';
import { calculateAvoidanceRoute, FALLBACK_CHECKPOINTS } from './checkpoints';

/** id เสถียรของ agent นี้ (ใช้ใน route entities และ registry) */
export const ROUTE_ESCORT_ID = 'route-escort';

/** กรองจุดตรวจ/กล้อง ALPR ที่ผ่าน routemap ของเครื่อง (ใช้แสดงผล) */
export const ROUTE_ESCORT_FILTER_TYPES = ['alpr', 'checkpoint'] as const;

/** sample คำสั่งที่ agent นี้รับได้ (แสดงใน AgentPanel) */
export const ROUTE_ESCORT_EXAMPLES = [
  'เลี่ยงด่านตรวจจากบ้านไปทำงาน',
  'หาเส้นทางหลีกเลี่ยงด่านจราจร เหนือวงแหวน',
  'สแกนกล้อง ALPR ใกล้สนามบิน',
];

export function createRouteEscortAgent(): AgentDefinition {
  return {
    id: ROUTE_ESCORT_ID,
    name: 'หน่วยคุ้มกันเส้นทาง',
    description: 'เลี่ยงด่านตรวจและรถติดได้ + สแกนจุดตรวจและกล้อง ALPR ในรัศมี',
    capabilities: [
      {
        id: 'route-escort.avoidance_navigation',
        label: 'หาเส้นทางเลี่ยงด่านตรวจ / รถติด',
        patterns: [
          /^(?:ช่วย|ช่วยผม)?\s*(?:เลี่ยง|หลีกเลี่ยง)\b.*/,
          /^(?:ช่วย|ช่วยผม)?\s*หาเส้นทาง.*/,
          /^(?:ช่วย|ช่วยผม)?\s*คำนวณเส้นทาง.*/,
          /^(?:ช่วย|ช่วยผม)?\s*route\s+((?:avoid|avoided|avoidance).*)$/i,
          /^(?:ช่วย|ช่วยผม)?\s*calculate\s+((?:avoid|avoided|avoidance).*)$/i,
        ],
        examples: [
          'เลี่ยงด่านตรวจจากบ้านไปทำงาน',
          'หาเส้นทางหลีกเลี่ยงด่านจราจรเหนือวงแหวน',
          'คำนวณเส้นทางจากบ้านไปโรงพยาบาล',
        ],
      },
      {
        id: 'route-escort.scan',
        label: 'สแกนจุดตรวจและกล้อง ALPR',
        patterns: [
          /^(?:ช่วย|ช่วยผม)?\s*สแกน.*/,
          /^(?:ช่วย|ช่วยผม)?\s*scan.*/i,
          /^(?:ช่วย|ช่วยผม)?\s*(?:ALPR|กล้อง).*/i,
          /^(?:ช่วย|ช่วยผม)?\s*ตรวจ.*/,
        ],
        examples: ['สแกนกล้อง ALPR ใกล้สนามบิน', 'ตรวจจุดตรวจใกล้เส้นทาง'],
      },
    ],
    async run({ text, commandText, capabilityId }) {
      const input = (text ?? commandText ?? '').trim();
      const lower = input.toLowerCase();

      // สายหลีกเลี่ยง/หาเส้นทาง -> คำนวณเส้นทางเลี่ยงด่าน
      if (
        capabilityId === 'route-escort.avoidance_navigation' ||
        lower.includes('เลี่ยง') ||
        lower.includes('หลีกเลี่ยง') ||
        lower.includes('route') ||
        lower.includes('calculate') ||
        lower.includes('เส้นทาง')
      ) {
        const origin = { lat: 13.68, lon: 100.74 };
        const destination = { lat: 13.70, lon: 100.76 };
        const route = calculateAvoidanceRoute(origin, destination, FALLBACK_CHECKPOINTS);

        return {
          reply:
            `คำนวณเส้นทางเลี่ยงด่านแล้วครับ: ${route.waypoints.length} จุด, ` +
            `เลี่ยง ${route.avoidedCheckpointsCount} จุดตรวจ, ` +
            `ระยะ ${route.distanceKm.toFixed(2)} กม., ` +
            `ประมาณ ${route.durationMin.toFixed(0)} นาที`,
          showScreen: true,
        };
      }

      // สแกนจุดตรวจ / กล้อง
      if (
        capabilityId === 'route-escort.scan' ||
        lower.includes('สแกน') ||
        lower.includes('scan') ||
        lower.includes('alpr') ||
        lower.includes('กล้อง') ||
        lower.includes('ตรวจ')
      ) {
        const nearby = FALLBACK_CHECKPOINTS.filter(
          (c) => c.type === 'alpr' || c.type === 'checkpoint',
        );
        return {
          reply: `พบจุดตรวจ / กล้อง ALPR ${nearby.length} จุดในเขตกรุงเทพฯ-สมุทรปราการ`,
          showScreen: true,
        };
      }

      return {
        reply:
          'ระบุคำสั่ง เช่น “เส้นทางเลี่ยงด่านจากบ้านไปทำงาน” หรือ “สแกนกล้อง ALPR” ครับ',
      };
    },
    // แบบ Lazy-load เพื่อประหยัด RAM (ไม่ import หน้าจอจนกว่าจะเปิด)
    loadScreen: async () => (await import('./RouteEscortScreen')).RouteEscortScreen,
  };
}

export const routeEscortAgent: AgentDefinition = createRouteEscortAgent();

/** ลงทะเบียน agent นี้ลง agentRegistry (เรียกจาก boot) */
export function registerRouteEscortAgent(): void {
  if (agentRegistry.has(ROUTE_ESCORT_ID)) return;
  agentRegistry.register(routeEscortAgent);
}

// exposet convention ของหลัก (เช่น sample-agent) — เอเจน route-escort
// เป็น agent แท้ของแอป ไม่ใช่ sample agent
