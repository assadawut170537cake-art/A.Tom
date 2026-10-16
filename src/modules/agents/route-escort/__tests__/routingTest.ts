// src/modules/agents/route-escort/__tests__/routingTest.ts
//
// Automated Proof-of-Concept test for RouteEscortAgent avoidance routing.
//
// Executed via Jest: `npx jest src/modules/agents/route-escort/__tests__/routingTest.ts`
//
// Assertions:
//   1. The returned route deviates from the direct path (more waypoints than origin→destination).
//   2. Zero waypoints fall within the prohibited 250m radius of active checkpoints.
//   3. avoidedCheckpointsCount >= 1.
//   4. Execution finishes under 3000ms.

import { describe, it, expect, beforeAll } from '@jest/globals';
import { agentBroker } from '../../../../core/agents/AgentBroker';
import { agentRegistry } from '../../../../core/agents/AgentRegistry';
import { routeEscortAgent } from '../index';
import { calculateAvoidanceRoute, haversineMeters } from '../routingEngine';
import { FALLBACK_CHECKPOINTS } from '../checkpoints';

beforeAll(() => {
  try {
    agentRegistry.register(routeEscortAgent);
  } catch {
    // already registered
  }
});

describe('RouteEscortAgent avoidance routing (POC)', () => {
  const origin = { lat: 13.68, lon: 100.74 };
  const destination = { lat: 13.70, lon: 100.76 };

  it('should route through broker sandbox and avoid checkpoints', async () => {
    const start = Date.now();

    // Execute via AgentBroker sandbox (8-second timeout guard).
    const result = await agentBroker.executeCommandSafe('route-escort', 'เส้นทางเลี่ยงด่านจากบ้านไปทำงาน');
    const elapsed = Date.now() - start;

    // Assert: execution finishes under 3000ms.
    expect(elapsed).toBeLessThan(3000);

    // Assert: reply contains avoidance confirmation.
    expect(result.reply).toContain('เลี่ยง');

    // Assert: shouldNavigate is true so the HUD screen is offered.
    expect(result.shouldNavigate).toBe(true);
  });

  it('should produce zero waypoints inside checkpoint radius', () => {
    const route = calculateAvoidanceRoute(origin, destination, FALLBACK_CHECKPOINTS);

    // Assert: at least one checkpoint was avoided.
    expect(route.avoidedCheckpointsCount).toBeGreaterThanOrEqual(1);

    // Assert: route deviates from direct path (more than 2 waypoints).
    expect(route.waypoints.length).toBeGreaterThan(2);

    // Assert: zero waypoints fall within any checkpoint's prohibited radius.
    for (const wp of route.waypoints) {
      for (const cp of FALLBACK_CHECKPOINTS) {
        const d = haversineMeters(cp, wp);
        expect(d).toBeGreaterThan(cp.radiusMeters);
      }
    }

    // Assert: distance is not shorter than direct (detour adds distance).
    expect(route.distanceKm).toBeGreaterThanOrEqual(route.directDistanceKm);

    // Log verified route summary for console output.
    console.log(
      '\n🗺️  RouteEscortAgent POC verified route:\n' +
      `  Waypoints: ${route.waypoints.length}\n` +
      `  Direct distance: ${route.directDistanceKm.toFixed(3)} km\n` +
      `  Avoidance distance: ${route.distanceKm.toFixed(3)} km\n` +
      `  Duration: ~${route.durationMin.toFixed(0)} min\n` +
      `  Avoid checkpoints: ${route.avoidedCheckpointsCount}\n` +
      `  Breached IDs: ${route.breachedCheckpoints.join(', ')}\n`
    );
  });
});
