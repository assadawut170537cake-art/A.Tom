// src/modules/agents/route-escort/routingEngine.ts
//
// Avoidance Routing Engine for RouteEscortAgent
//
// Input: origin, destination, avoidList (Checkpoint[])
// Logic:
//   1. Build a polyline from origin to destination (linear interpolation / great-circle approximation).
//   2. Detect collisions where any polyline segment breaches a checkpoint.radiusMeters (default 250m).
//   3. Calculate detour waypoints around breached perimeters using tangential offset coordinates.
//   4. Return final optimized route with statistics.
//
// Reference: gods-eye-view `plan_route` tool (OSRM / OpenRouteService driving route) provides
// the base path; this engine adds the active avoidance layer that gods-eye-view lacks.

import type { Checkpoint } from './checkpoints';
import { haversineMeters } from './checkpoints';

export interface Coord {
  lat: number;
  lon: number;
}

export interface RouteResult {
  /** Ordered waypoints including origin and destination. */
  readonly waypoints: readonly Coord[];
  /** Estimated duration in minutes (assumes 40 km/h urban average). */
  readonly durationMin: number;
  /** Total route distance in kilometers. */
  readonly distanceKm: number;
  /** Number of checkpoints that were avoided. */
  readonly avoidedCheckpointsCount: number;
  /** Ids of checkpoints that breached the direct path. */
  readonly breachedCheckpoints: readonly string[];
  /** Direct (straight-line) distance in kilometers. */
  readonly directDistanceKm: number;
}

/** พิกัดตัวอย่างแถวบางนา–สมุทรปราการ (ใช้จนกว่าจะอ่านต้นทาง/ปลายทางจากข้อความได้) */
export const DEMO_ORIGIN: Coord = { lat: 13.68, lon: 100.74 };
export const DEMO_DESTINATION: Coord = { lat: 13.7, lon: 100.76 };

const DEFAULT_SPEED_KMH = 40; // urban average speed

/**
 * Haversine distance in meters between two coordinates.
 * Re-exported for test assertions.
 */
export { haversineMeters };

/**
 * Build a polyline of evenly-spaced points between origin and destination.
 * Used as the "standard route" before avoidance offsets are applied.
 */
function interpolatePath(origin: Coord, destination: Coord, segments: number = 100): Coord[] {
  const points: Coord[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      lat: origin.lat + (destination.lat - origin.lat) * t,
      lon: origin.lon + (destination.lon - origin.lon) * t,
    });
  }
  return points;
}

/**
 * Distance from point `p` to line segment `a`–`b` in meters,
 * using a local tangent-plane projection at the segment midpoint.
 */
function pointToSegmentDistanceMeters(p: Coord, a: Coord, b: Coord): number {
  const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
  const cosLat = Math.cos((mid.lat * Math.PI) / 180);
  const toMeters = (c: Coord) => ({
    x: (c.lon - mid.lon) * 111_320 * cosLat,
    y: (c.lat - mid.lat) * 111_320,
  });
  const pa = toMeters(a);
  const pb = toMeters(b);
  const pp = toMeters(p);

  const l2 = (pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2;
  if (l2 === 0) return haversineMeters(p, a);

  let t = ((pp.x - pa.x) * (pb.x - pa.x) + (pp.y - pa.y) * (pb.y - pa.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = pa.x + t * (pb.x - pa.x);
  const projY = pa.y + t * (pb.y - pa.y);

  const dx = pp.x - projX;
  const dy = pp.y - projY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the avoidance route.
 *
 * For each checkpoint whose radius is breached by the direct polyline, a detour
 * waypoint is placed just outside the checkpoint perimeter along the vector from
 * the checkpoint center to the closest point on the path.
 */
export function calculateAvoidanceRoute(
  origin: Coord,
  destination: Coord,
  avoidList: readonly Checkpoint[]
): RouteResult {
  const directDistanceKm = haversineMeters(origin, destination) / 1000;

  const path = interpolatePath(origin, destination, 100);

  // ---- Detect breaches -----------------------------------------------------
  const breached: string[] = [];
  const breachSegments: {
    checkpoint: Checkpoint;
    closestPoint: Coord;
  }[] = [];

  for (const cp of avoidList) {
    let minDist = Infinity;
    let closestPoint = origin;

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (!a || !b) continue;
      const d = pointToSegmentDistanceMeters(cp, a, b);
      if (d < minDist) {
        minDist = d;
        closestPoint = a;
      }
    }

    if (minDist <= cp.radiusMeters) {
      breached.push(cp.id);
      breachSegments.push({ checkpoint: cp, closestPoint });
    }
  }

  // ---- Build detour waypoints ---------------------------------------------
  const waypoints: Coord[] = [origin];

  for (const bs of breachSegments) {
    const { checkpoint, closestPoint } = bs;

    // Vector from checkpoint center to closest point on the breached path.
    const dx = closestPoint.lon - checkpoint.lon;
    const dy = closestPoint.lat - checkpoint.lat;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Place waypoint just outside the radius (+50 m safety buffer).
    const offsetFactor = (checkpoint.radiusMeters + 50) / dist;
    const offsetLat = checkpoint.lat + dy * offsetFactor;
    const offsetLon = checkpoint.lon + dx * offsetFactor;

    waypoints.push({ lat: offsetLat, lon: offsetLon });
  }

  waypoints.push(destination);

  // ---- Compute statistics --------------------------------------------------
  let totalDistanceMeters = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (!a || !b) continue;
    totalDistanceMeters += haversineMeters(a, b);
  }

  const distanceKm = totalDistanceMeters / 1000;
  const durationMin = (distanceKm / DEFAULT_SPEED_KMH) * 60;

  return {
    waypoints,
    durationMin,
    distanceKm,
    avoidedCheckpointsCount: breached.length,
    breachedCheckpoints: breached,
    directDistanceKm,
  };
}
