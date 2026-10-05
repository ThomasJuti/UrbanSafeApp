import type { LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

export type RoutePath = { lengthM: number; path: [number, number][] };

type Row = { edges: number; length_m: number | null; geojson: string | null };

export async function queryRoute(db: Db, from: LatLng, to: LatLng, marginM: number): Promise<RoutePath | null> {
  const { rows } = await sql<Row>`
    select count(*)::int as edges, sum(length_m) as length_m, ST_AsGeoJSON(ST_MakeLine(geom order by seq), 6) as geojson
    from route_between(${from.lng}, ${from.lat}, ${to.lng}, ${to.lat}, ${marginM})
  `.execute(db);

  const row = rows[0];
  if (!row || row.edges === 0 || !row.geojson) return null;
  const line = JSON.parse(row.geojson) as { coordinates: [number, number][] };
  return { lengthM: row.length_m ?? 0, path: line.coordinates };
}

export async function findRoute(
  db: Db,
  from: LatLng,
  to: LatLng,
  marginM: number,
  statementTimeoutMs: number,
): Promise<RoutePath | null> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`.execute(trx);
    return queryRoute(trx, from, to, marginM);
  });
}
