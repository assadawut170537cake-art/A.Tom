import { AgentRegistry } from '../core/agents/AgentRegistry';
import { FALLBACK_CHECKPOINTS, haversineMeters } from '../modules/agents/route-escort/checkpoints';
import { createRouteEscortAgent, registerRouteEscortAgent, ROUTE_ESCORT_AGENT_ID } from '../modules/agents/route-escort';
import { calculateAvoidanceRoute, DEMO_DESTINATION, DEMO_ORIGIN } from '../modules/agents/route-escort/routingEngine';
import { nth } from '../test-utils/nth';

describe('routingEngine', () => {
  const route = calculateAvoidanceRoute(DEMO_ORIGIN, DEMO_DESTINATION, FALLBACK_CHECKPOINTS);

  it('เลี่ยงอย่างน้อย 1 จุด และเส้นทางอ้อมจากเส้นตรง', () => {
    expect(route.avoidedCheckpointsCount).toBeGreaterThanOrEqual(1);
    expect(route.waypoints.length).toBeGreaterThan(2);
    expect(route.distanceKm).toBeGreaterThanOrEqual(route.directDistanceKm);
  });

  it('ไม่มี waypoint ใดอยู่ในรัศมีเลี่ยงของจุดตรวจ', () => {
    for (const wp of route.waypoints.slice(1, -1)) {
      for (const cp of FALLBACK_CHECKPOINTS) {
        expect(haversineMeters(cp, wp)).toBeGreaterThan(cp.radiusMeters);
      }
    }
  });

  it('ไม่มีจุดตรวจ → เส้นตรงต้นทาง→ปลายทาง', () => {
    const direct = calculateAvoidanceRoute(DEMO_ORIGIN, DEMO_DESTINATION, []);
    expect(direct.waypoints).toEqual([DEMO_ORIGIN, DEMO_DESTINATION]);
    expect(direct.avoidedCheckpointsCount).toBe(0);
  });
});

describe('route-escort agent', () => {
  it('ลงทะเบียนซ้ำได้โดยไม่ throw', () => {
    const registry = new AgentRegistry();
    registerRouteEscortAgent(registry);
    expect(() => registerRouteEscortAgent(registry)).not.toThrow();
    expect(registry.has(ROUTE_ESCORT_AGENT_ID)).toBe(true);
  });

  it('run route.avoid ตอบเป็นภาษาไทยและขอเปิดหน้าจอ', async () => {
    const result = await createRouteEscortAgent().run({
      text: 'เส้นทางเลี่ยงด่าน',
      commandText: '',
      capabilityId: 'route.avoid',
      persona: 1,
    });
    expect(result.reply).toContain('เลี่ยง');
    expect(result.showScreen).toBe(true);
  });

  it('run route.scan นับเฉพาะกล้อง/ด่าน ไม่รวมจุดรถติด', async () => {
    const expected = FALLBACK_CHECKPOINTS.filter((c) => c.type !== 'traffic_jam').length;
    const result = await createRouteEscortAgent().run({
      text: 'สแกนกล้อง ALPR',
      commandText: '',
      capabilityId: 'route.scan',
      persona: 1,
    });
    expect(result.reply).toContain(`${expected} จุด`);
  });

  describe('pattern ของ capability', () => {
    const registry = new AgentRegistry();
    registerRouteEscortAgent(registry);
    const capabilities = registry.listCapabilities();
    const matches = (text: string) =>
      capabilities.find(({ capability }) => capability.patterns.some((p) => p.test(text)))?.capability.id;

    it.each([
      ['เส้นทางเลี่ยงด่านจากบ้านไปทำงาน', 'route.avoid'],
      ['หาเส้นทางเลี่ยงกล้อง', 'route.avoid'],
      ['สแกนกล้อง ALPR', 'route.scan'],
      ['สแกนด่านตรวจ', 'route.scan'],
    ])('"%s" → %s', (text, id) => {
      expect(matches(text)).toBe(id);
    });

    it.each(['เส้นทางนี้ไกลไหม', 'วันนี้อากาศดี', 'ผมเห็นด่านตรวจเมื่อวาน'])('"%s" ไม่โดน agent แย่ง', (text) => {
      expect(matches(text)).toBeUndefined();
    });

    it('มี capability 2 ตัวตามลำดับ', () => {
      expect(nth(capabilities, 0).capability.id).toBe('route.avoid');
      expect(nth(capabilities, 1).capability.id).toBe('route.scan');
    });
  });
});
