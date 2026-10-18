// src/modules/agents/route-escort/__tests__/routingTest.ts
//
// Automated test สำหรับ RouteEscortAgent (avoidance routing)
// รัน: npx jest src/modules/agents/route-escort/__tests__/routingTest.ts
//
// Assertions:
//   1. ระบบจับคู่ capability / run ให้คำตอบถูกต้อง (ไม่ผ่าน AgentBroker อีกต่อไป)
//   2. ระยะทางไม่ shorter than direct (เลี่ยงเพิ่มระยะ)
//   3. Zero waypoints < 250m (ปราศจากด่านตรวจ)
//   4. One waypoint per avoided checkpoint >= 1

import { describe, it, expect, beforeAll } from '@jest/globals';
import { agentRegistry } from '../../../../core/agents/AgentRegistry';
import { createRouteEscortAgent, ROUTE_ESCORT_ID } from '../index';
import { calculateAvoidanceRoute, haversineMeters, FALLBACK_CHECKPOINTS } from '../checkpoints';

beforeAll(() => {
  try {
    agentRegistry.register(createRouteEscortAgent());
  } catch {}
});

describe('route-escort avoidance routing', () => {
  const origin = { lat: 13.68, lon: 100.74 };
  const destination = { lat: 13.70, lon: 100.76 };

  it('should compute a route and respond with Thai summary', async () => {
    const result = await agentRegistry.run(ROUTE_ESCORT_ID, {
      text: 'เส้นทางเลี่ยงด่านจากบ้านไปทำงาน',
      commandText: 'เส้นทางเลี่ยงด่านจากบ้านไปทำงาน',
      persona: 1,
    });

    expect(result.reply).toContain('เลี่ยงด่านแล้วครับ');
    expect(result.showScreen).toBe(true);
  });

  it('should compute a detour: more distance than direct, more than 2 waypoints', () => {
    const route = calculateAvoidanceRoute(origin, destination, FALLBACK_CHECKPOINTS);

    expect(route.avoidedCheckpointsCount).toBeGreaterThanOrEqual(1);
    expect(route.waypoints.length).toBeGreaterThan(2);
    expect(route.distanceKm).toBeGreaterThanOrEqual(route.directDistanceKm);
  });

  it('should produce zero waypoints inside any checkpoint radius', () => {
    const route = calculateAvoidanceRoute(origin, destination, FALLBACK_CHECKPOINTS);

    for (const wp of route.waypoints) {
      for (const cp of FALLBACK_CHECKPOINTS) {
        expect(haversineMeters(cp, wp)).toBeGreaterThan(cp.radiusMeters);
      }
    }
  });

  it('should give a useful Thai reply when no keywords matched', async () => {
    const result = await agentRegistry.run(ROUTE_ESCORT_ID, {
      text: 'วันนี้อากาศดีครับ',
      commandText: 'วันนี้อากาศดีครับ',
      persona: 1,
    });

    expect(result.reply).toContain('ระบุคำสั่ง');
  });
});
