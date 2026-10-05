import { PARAMS, type Bbox, type MapIncident, type Severity } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

function selectMapIncidents(db: Db) {
  return db
    .selectFrom('incidents')
    .select([
      'id',
      'type',
      'severity',
      'location_kind',
      'location_name',
      'occurred_at',
      'time_known',
      'confidence',
      // No uso el centroide porque en barrios con forma rara puede caer fuera del polígono.
      sql<number>`ST_X(ST_PointOnSurface(geom))`.as('lng'),
      sql<number>`ST_Y(ST_PointOnSurface(geom))`.as('lat'),
    ]);
}

type MapIncidentRow = Awaited<ReturnType<ReturnType<typeof selectMapIncidents>['executeTakeFirstOrThrow']>>;

function toMapIncident(row: MapIncidentRow): MapIncident {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity as Severity,
    location:
      row.location_kind === 'point'
        ? { kind: 'point', point: { lat: row.lat, lng: row.lng } }
        : {
            kind: 'area',
            level: row.location_kind,
            name: row.location_name ?? '',
            point: { lat: row.lat, lng: row.lng },
          },
    occurredAt: row.occurred_at.toISOString(),
    timeKnown: row.time_known,
    confidence: row.confidence,
  };
}

export async function listVisibleInBbox(db: Db, bbox: Bbox, limit: number): Promise<MapIncident[]> {
  const rows = await selectMapIncidents(db)
    .where('confidence', '>=', PARAMS.visibilityThreshold)
    .where('occurred_at', '>=', sql<Date>`now() - make_interval(secs => ${PARAMS.mapWindowMs / 1000})`)
    .where(
      sql<boolean>`geom && ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)`,
    )
    .orderBy('occurred_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toMapIncident);
}

export async function getMapIncident(db: Db, id: string): Promise<MapIncident> {
  return toMapIncident(await selectMapIncidents(db).where('id', '=', id).executeTakeFirstOrThrow());
}
