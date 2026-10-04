import { PARAMS, type Bbox, type MapIncident, type Severity } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

export async function listVisibleInBbox(db: Db, bbox: Bbox, limit: number): Promise<MapIncident[]> {
  const rows = await db
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
    ])
    .where('confidence', '>=', PARAMS.visibilityThreshold)
    .where(
      sql<boolean>`geom && ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)`,
    )
    .orderBy('occurred_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
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
  }));
}
