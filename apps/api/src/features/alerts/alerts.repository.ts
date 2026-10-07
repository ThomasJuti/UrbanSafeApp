import { PARAMS, type LngLat, type MapIncident, type Severity } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';
import type { AlertSpan } from './ahead';

// Cerca del ecuador; solo prefiltra el índice. La distancia real va en geography.
const METERS_PER_DEGREE = 111_320;

export type AlertCandidate = { incident: MapIncident; span: AlertSpan };

type Row = {
  id: string;
  type: MapIncident['type'];
  severity: number;
  location_kind: 'point' | 'neighborhood' | 'locality' | 'street';
  location_name: string | null;
  occurred_at: Date;
  time_known: boolean;
  confidence: number;
  lng: number;
  lat: number;
  along_start_m: number | null;
  along_end_m: number | null;
};

function toCandidate(row: Row): AlertCandidate | null {
  if (row.along_start_m === null || row.along_end_m === null) return null;
  const point = { lng: row.lng, lat: row.lat };
  return {
    span: { alongStartM: row.along_start_m, alongEndM: row.along_end_m },
    incident: {
      id: row.id,
      type: row.type,
      severity: row.severity as Severity,
      location:
        row.location_kind === 'point'
          ? { kind: 'point', point }
          : { kind: 'area', level: row.location_kind, name: row.location_name ?? '', point },
      occurredAt: row.occurred_at.toISOString(),
      timeKnown: row.time_known,
      confidence: row.confidence,
    },
  };
}

// Proyecta el incidente sobre la ruta: el tramo de la línea que cae a `radiusM` de su geometría.
// Un punto queda en un solo metro. Una localidad que contiene la ruta ocupa la línea entera.
async function candidates(db: Db, path: readonly LngLat[], at: Date, incidentId?: string): Promise<AlertCandidate[]> {
  if (path.length < 2) return [];
  const line = JSON.stringify({ type: 'LineString', coordinates: path });
  const reportedSince = new Date(at.getTime() - PARAMS.alertWindow.reportedWithinMs);
  const occurredSince = new Date(at.getTime() - PARAMS.alertWindow.occurredWithinMs);
  const radius = PARAMS.alert.radiusM;
  const { rows } = await sql<Row>`
    with route as (
      select ST_SetSRID(ST_GeomFromGeoJSON(${line}), 4326) as geom
    ),
    line as (
      select geom, geom::geography as geog, ST_Length(geom::geography) as length_m from route
    ),
    hits as (
      select i.id, i.type, i.severity, i.location_kind, i.location_name, i.occurred_at, i.time_known, i.confidence,
        ST_X(ST_PointOnSurface(i.geom)) as lng,
        ST_Y(ST_PointOnSurface(i.geom)) as lat,
        ST_Intersection(line.geom, ST_Buffer(i.geom::geography, ${radius})::geometry) as overlap,
        line.geom as route_geom,
        line.length_m
      from incidents i
      cross join line
      where i.confidence >= ${PARAMS.visibilityThreshold}
        and i.reported_at >= ${reportedSince}
        and i.occurred_at >= ${occurredSince}
        and i.geom && ST_Expand(line.geom, ${radius / METERS_PER_DEGREE})
        and ST_DWithin(i.geom::geography, line.geog, ${radius})
        and (${incidentId ?? null}::uuid is null or i.id = ${incidentId ?? null}::uuid)
    )
    select id, type, severity, location_kind, location_name, occurred_at, time_known, confidence, lng, lat,
      (select min(ST_LineLocatePoint(route_geom, dp.geom)) from ST_DumpPoints(overlap) dp) * length_m as along_start_m,
      (select max(ST_LineLocatePoint(route_geom, dp.geom)) from ST_DumpPoints(overlap) dp) * length_m as along_end_m
    from hits
  `.execute(db);

  return rows.flatMap((row) => {
    const candidate = toCandidate(row);
    return candidate ? [candidate] : [];
  });
}

export function createAlertQueries(db: Db) {
  return {
    candidatesForPath(path: readonly LngLat[], at: Date) {
      return candidates(db, path, at);
    },
    async candidateOnPath(id: string, path: readonly LngLat[], at: Date) {
      const [found] = await candidates(db, path, at, id);
      return found ?? null;
    },
  };
}

export type AlertQueries = ReturnType<typeof createAlertQueries>;
