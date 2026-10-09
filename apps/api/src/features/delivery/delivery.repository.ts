import type { LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

// Más lejos que esto el punto cayó en un parque, un humedal o los cerros.
const MAX_SNAP_M = 200;

type Row = { idx: number; lng: number | null; lat: number | null; distance_m: number | null; in_bogota: boolean };

// El casco urbano es un rectángulo que también toma Soacha, Mosquera, Funza y Chía, y el grafo
// trae sus calles. Un pedido solo sirve si el vértice cae dentro de alguna localidad de Bogotá.
export async function snapToRoads(db: Db, points: LatLng[]): Promise<(LatLng | null)[]> {
  const { rows } = await sql<Row>`
    select p.idx::int as idx, ST_X(v.geom) as lng, ST_Y(v.geom) as lat,
      ST_Distance(v.geom::geography, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography) as distance_m,
      exists (select 1 from locality_base_risk l where ST_Intersects(l.geom, v.geom)) as in_bogota
    from unnest(${points.map((point) => point.lng)}::float8[], ${points.map((point) => point.lat)}::float8[])
      with ordinality as p(lng, lat, idx)
    left join lateral (
      select geom from road_vertices
      order by geom <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
      limit 1
    ) v on true
  `.execute(db);

  return points.map((_, index) => {
    const row = rows.find((candidate) => candidate.idx === index + 1);
    if (!row || row.lng === null || row.lat === null || row.distance_m === null || row.distance_m > MAX_SNAP_M) return null;
    if (!row.in_bogota) return null;
    return { lng: row.lng, lat: row.lat };
  });
}
