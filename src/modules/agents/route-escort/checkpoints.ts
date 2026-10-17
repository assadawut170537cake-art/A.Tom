// src/modules/agents/route-escort/checkpoints.ts
//
// Data Layer & Checkpoint Registry for RouteEscortAgent
// Compatible with OpenStreetMap / DeFlock ALPR node schema.
//
// Reference architecture:
// - gods-eye-view `find_alpr_cameras` tool: OpenStreetMap-mapped license plate readers
// - DeFlock: Crowdsourced ALPR locations (id, lat, lon, type, direction)
// - gods-eye-view `plan_route` tool: OSRM / OpenRouteService driving route
//
// Gap filled here: active avoidance pathfinding that computes detour waypoints
// around ALPR / checkpoint radiuses (gods-eye-view only displays them on a globe).

export type CheckpointType = 'alpr' | 'checkpoint' | 'traffic_jam';

export interface Checkpoint {
  /** Stable node id (OSM way/node id or DeFlock report id). */
  readonly id: string;
  /** Latitude (WGS84). */
  readonly lat: number;
  /** Longitude (WGS84). */
  readonly lon: number;
  /** Type of surveillance / obstruction node. */
  readonly type: CheckpointType;
  /** Avoidance radius in meters (default 250m per spec). */
  readonly radiusMeters: number;
  /** Human-readable label for HUD display. */
  readonly label?: string;
}

export const DEFAULT_RADIUS_METERS = 250;

/**
 * Parse an OpenStreetMap ALPR / surveillance node into a Checkpoint.
 * Expected OSM tags: `man_maker=surveillance`, `surveillance=alpr`, `location=...`
 */
export function parseOSMALPRNode(raw: {
  id: string | number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}): Checkpoint {
  const tags = raw.tags ?? {};
  return {
    id: `osm-${raw.id}`,
    lat: raw.lat,
    lon: raw.lon,
    type: tags.surveillance === 'alpr' ? 'alpr' : 'checkpoint',
    radiusMeters: DEFAULT_RADIUS_METERS,
    label: tags.location || tags.name || 'OSM ALPR Node',
  };
}

/**
 * Parse a DeFlock ALPR report into a Checkpoint.
 * DeFlock schema (crowdsourced): id, lat, lon, type, direction, make, model.
 */
export function parseDeFlockALPRNode(raw: {
  id: string | number;
  lat: number;
  lon: number;
  type?: string;
  direction?: string;
  make?: string;
  model?: string;
}): Checkpoint {
  return {
    id: `deflock-${raw.id}`,
    lat: raw.lat,
    lon: raw.lon,
    type: (raw.type ?? 'alpr') as CheckpointType,
    radiusMeters: DEFAULT_RADIUS_METERS,
    label: `DeFlock ${raw.make ?? ''} ${raw.model ?? ''} ${raw.direction ?? ''}`.trim() || 'DeFlock ALPR',
  };
}

/**
 * Active fallback coordinate nodes for Bangkok / Samut Prakan corridors.
 * Ensures zero-network offline testability of the avoidance engine.
 * Coordinates are representative survey points along Bangna-Trat and Sukhumvit corridors.
 */
export const FALLBACK_CHECKPOINTS: readonly Checkpoint[] = [
  // Bangna-Trat corridor (ALPR surveillance)
  {
    id: 'bkk-alpr-001',
    lat: 13.6838,
    lon: 100.7461,
    type: 'alpr',
    radiusMeters: 250,
    label: 'ALPR Bangna-Trat km.7',
  },
  // Police checkpoint on Bangna-Trat
  {
    id: 'bkk-cp-002',
    lat: 13.69,
    lon: 100.752,
    type: 'checkpoint',
    radiusMeters: 200,
    label: 'ด่านตรวจ บางนา-ตราด กม.9',
  },
  // Sukhumvit near Samut Prakan border
  {
    id: 'spk-alpr-003',
    lat: 13.65,
    lon: 100.62,
    type: 'alpr',
    radiusMeters: 300,
    label: 'ALPR สุขุมวิท ต.ปากน้ำ',
  },
  // Bangna-Trat km.13 checkpoint
  {
    id: 'bkk-cp-004',
    lat: 13.66,
    lon: 100.70,
    type: 'checkpoint',
    radiusMeters: 250,
    label: 'ด่านตรวจ บางนา-ตราด กม.13',
  },
  // Outer ring road ALPR
  {
    id: 'bkk-alpr-005',
    lat: 13.70,
    lon: 100.78,
    type: 'alpr',
    radiusMeters: 250,
    label: 'ALPR วงแหวนรอบนอก',
  },
  // Traffic jam hotspot
  {
    id: 'bkk-traffic-006',
    lat: 13.67,
    lon: 100.68,
    type: 'traffic_jam',
    radiusMeters: 400,
    label: 'รถติดหนาแน่น บางนา-ตราด',
  },
];

/** Lookup checkpoints by type. */
export function filterByType(checkpoints: readonly Checkpoint[], type: CheckpointType): Checkpoint[] {
  return checkpoints.filter((c) => c.type === type);
}

/** Lookup checkpoints within a radius (meters) of a center point using haversine. */
export function findNearby(
  checkpoints: readonly Checkpoint[],
  center: { lat: number; lon: number },
  radiusMeters: number,
): Checkpoint[] {
  return checkpoints.filter((c) => haversineMeters(center, c) <= radiusMeters);
}

/** Haversine distance in meters between two coordinates. */
export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000; // earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
