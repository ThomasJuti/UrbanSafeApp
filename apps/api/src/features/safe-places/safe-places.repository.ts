import type { SafePlace } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

// Son unos cientos de puntos en todo el casco urbano: se listan completos.
export async function listSafePlaces(db: Db): Promise<SafePlace[]> {
  const rows = await db
    .selectFrom('safe_places')
    .select(['id', 'kind', 'name', sql<number>`ST_X(geom)`.as('lng'), sql<number>`ST_Y(geom)`.as('lat')])
    .orderBy('id')
    .execute();

  return rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, point: { lat: row.lat, lng: row.lng } }));
}
