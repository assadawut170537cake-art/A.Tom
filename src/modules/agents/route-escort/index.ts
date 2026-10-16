// src/modules/agents/route-escort/index.ts
//
// RouteEscortAgent — AtomAgent implementation for avoidance navigation.
//
// Capabilities:
//   - avoidance_navigation: ค้นหาเส้นทางเลี่ยงด่านตรวจและรถติด
//   - scan_surveillance:    สแกนจุดตรวจและกล้อง ALPR ในรัศมีเดินทาง
//
// Executed via AgentBroker sandbox with 8-second timeout guard.
// Lazy-loads tactical HUD map component via getScreenComponent().

import type { AtomAgent, AgentResult } from '../../../core/agents/types';
import { agentBroker } from '../../../core/agents/AgentBroker';
import { agentRegistry } from '../../../core/agents/AgentRegistry';
import { calculateAvoidanceRoute } from './routingEngine';
import { FALLBACK_CHECKPOINTS } from './checkpoints';

export type RouteRequest = {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
};

export type ScanRequest = {
  center: { lat: number; lon: number };
  radiusMeters?: number;
};

/** Execute the agent through the broker sandbox (for direct programmatic use). */
export const routeEscortExecute = (input: string) =>
  agentBroker.executeCommandSafe('route-escort', input);

export const routeEscortAgent: AtomAgent = {
  id: 'route-escort',
  name: 'หน่วยคุ้มกันเส้นทาง',
  version: '1.0.0',
  enabled: true,
  capabilities: [
    {
      intent: 'avoidance_navigation',
      description: 'ค้นหาเส้นทางเลี่ยงด่านตรวจและรถติด',
      example: 'เส้นทางจากบ้านไปทำงาน เลี่ยงด่านตรวจ',
    },
    {
      intent: 'scan_surveillance',
      description: 'สแกนจุดตรวจและกล้อง ALPR ในรัศมีเดินทาง',
      example: 'สแกนกล้อง ALPR รอบเส้นทางบางนา',
    },
  ],

  async handle(input: string): Promise<AgentResult> {
    const clean = input.trim().toLowerCase();

    // ---- Avoidance navigation ---------------------------------------------
    if (clean.includes('เลี่ยง') || clean.includes('avoid') || clean.includes('เส้นทาง')) {
      // Default Bangkok / Samut Prakan corridor demo route.
      const origin: { lat: number; lon: number } = { lat: 13.68, lon: 100.74 };
      const destination: { lat: number; lon: number } = { lat: 13.70, lon: 100.76 };

      const route = calculateAvoidanceRoute(origin, destination, FALLBACK_CHECKPOINTS);

      return {
        reply:
          `คำนวณเส้นทางเลี่ยงด่านแล้วครับ: ${route.waypoints.length} จุดพิจารณา, ` +
          `เลี่ยง ${route.avoidedCheckpointsCount} จุดตรวจ, ` +
          `ระยะ ${route.distanceKm.toFixed(2)} กม., ` +
          `ประมาณ ${route.durationMin.toFixed(0)} นาที`,
        data: { route, type: 'avoidance_navigation' },
        shouldNavigate: true,
      };
    }

    // ---- Surveillance scan -------------------------------------------------
    if (clean.includes('สแกน') || clean.includes('scan') || clean.includes('alpr') || clean.includes('กล้อง')) {
      const nearby = FALLBACK_CHECKPOINTS.filter(
        (c) => c.type === 'alpr' || c.type === 'checkpoint'
      );
      return {
        reply: `พบจุดตรวจ / กล้อง ALPR ${nearby.length} จุดในเขตกรุงเทพฯ-สมุทรปราการ`,
        data: { checkpoints: nearby, type: 'scan_surveillance' },
      };
    }

    return {
      reply:
        'ระบุคำสั่ง เช่น “เส้นทางเลี่ยงด่านจากบ้านไปทำงาน” หรือ “สแกนกล้อง ALPR” ครับ',
    };
  },

  // 📦 Lazy-load tactical HUD map component (ประหยัด RAM)
  async getScreenComponent() {
    const module = await import('./RouteEscortScreen');
    return module.RouteEscortScreen;
  },
};

/** Register the agent into the global registry during app bootstrap. */
export function registerRouteEscortAgent(): void {
  agentRegistry.register(routeEscortAgent);
}
