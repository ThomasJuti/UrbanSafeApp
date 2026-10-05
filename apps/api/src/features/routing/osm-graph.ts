import { PARAMS } from '@urbansafe/shared';

export type OsmTags = Record<string, string>;
export type OsmWay = { id: number; nodes: number[]; tags: OsmTags };
export type OsmNode = { id: number; lat: number; lon: number };

export type RoadEdge = {
  osmWayId: number;
  source: number;
  target: number;
  highway: string;
  name: string | null;
  lengthM: number;
  costS: number;
  reverseCostS: number;
  coords: [number, number][];
};

export const RIDEABLE_HIGHWAYS = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
] as const;

const BLOCKED = new Set(['no', 'private']);
const ALLOWED = new Set(['yes', 'designated', 'permissive', 'destination']);
const IMPLIED_ONEWAY = new Set(['motorway', 'motorway_link']);
const UNREACHABLE = -1;
const EARTH_RADIUS_M = 6_371_008.8;

export function isRideable(tags: OsmTags): boolean {
  const highway = tags['highway'];
  if (!highway || !(RIDEABLE_HIGHWAYS as readonly string[]).includes(highway)) return false;
  if (tags['area'] === 'yes') return false;
  const explicitAllow = ALLOWED.has(tags['motorcycle'] ?? '') || ALLOWED.has(tags['motor_vehicle'] ?? '');
  if (explicitAllow) return true;
  return !['access', 'motor_vehicle', 'motorcycle'].some((key) => BLOCKED.has(tags[key] ?? ''));
}

export type Direction = 'both' | 'forward' | 'backward';

export function directionOf(tags: OsmTags): Direction {
  const oneway = tags['oneway'];
  if (oneway === '-1' || oneway === 'reverse') return 'backward';
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return 'forward';
  if (oneway === 'no' || oneway === 'false' || oneway === '0') return 'both';
  if (tags['junction'] === 'roundabout' || tags['junction'] === 'circular') return 'forward';
  return IMPLIED_ONEWAY.has(tags['highway'] ?? '') ? 'forward' : 'both';
}

export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;

// Una vía de OSM cruza muchas otras; para rutear hay que partirla en cada nodo compartido.
export function buildRoadEdges(ways: OsmWay[], nodes: Map<number, OsmNode>): RoadEdge[] {
  const rideable = ways.filter((way) => isRideable(way.tags));
  const usage = new Map<number, number>();
  for (const way of rideable) {
    for (const id of way.nodes) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  const edges: RoadEdge[] = [];
  for (const way of rideable) {
    const direction = directionOf(way.tags);
    let current: number[] = [];

    const flush = () => {
      if (current.length < 2) return;
      const coords = current.map((id) => {
        const node = nodes.get(id)!;
        return [node.lon, node.lat] as [number, number];
      });
      let lengthM = 0;
      for (let i = 1; i < coords.length; i++) lengthM += haversineM(coords[i - 1]!, coords[i]!);
      if (lengthM <= 0) return;
      const seconds = lengthM / metersPerSecond;
      edges.push({
        osmWayId: way.id,
        source: current[0]!,
        target: current.at(-1)!,
        highway: way.tags['highway']!,
        name: way.tags['name'] ?? null,
        lengthM,
        costS: direction === 'backward' ? UNREACHABLE : seconds,
        reverseCostS: direction === 'forward' ? UNREACHABLE : seconds,
        coords,
      });
    };

    for (const [index, id] of way.nodes.entries()) {
      // Si falta un nodo (la vía se sale de la caja descargada) se corta ahí.
      if (!nodes.has(id)) {
        flush();
        current = [];
        continue;
      }
      current.push(id);
      const isEnd = index === way.nodes.length - 1;
      if (!isEnd && current.length > 1 && (usage.get(id) ?? 0) > 1) {
        flush();
        current = [id];
      }
    }
    flush();
  }
  return edges;
}
