import { PARAMS, type LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

// Cerca del ecuador; solo sirve de prefiltro para el índice, la distancia real va en geography.
const METERS_PER_DEGREE = 111_320;

export type RoutePath = { lengthM: number; riskScore: number; nearbyIncidentIds: string[]; path: [number, number][] };

export type RoutesQuery = { from: LatLng; to: LatLng; marginM: number; alphas: readonly number[]; band: number };

type Row = {
  idx: number;
  length_m: number;
  risk_score: number | null;
  geojson: string;
  nearby: string[] | null;
};

// Una ruta por α, en el mismo orden. Null en la posición de la que no tenga camino dentro de la caja.
// Van en serie dentro de una sola consulta: el Dijkstra es pura CPU y en paralelo se estorban
// hasta tardar más que en serie.
// Con velocidad fija, ponderar por longitud es lo mismo que ponderar por tiempo de recorrido (M5).
export async function queryRoutes(
  db: Db,
  { from, to, marginM, alphas, band }: RoutesQuery,
): Promise<(RoutePath | null)[]> {
  const { rows } = await sql<Row>`
    with steps as (
      select a.idx::int as idx, r.*
      from unnest(${alphas}::float8[]) with ordinality as a(alpha, idx)
      cross join lateral route_between(${from.lng}, ${from.lat}, ${to.lng}, ${to.lat}, ${marginM}, a.alpha, ${band}::integer) r
    ),
    lines as (
      select idx,
        sum(length_m) as length_m,
        sum(length_m * risk) / nullif(sum(length_m), 0) as risk_score,
        ST_MakeLine(geom order by seq) as geom
      from steps
      group by idx
    )
    select idx, length_m, risk_score, ST_AsGeoJSON(geom, 6) as geojson,
      array(
        select i.id from incidents i
        where i.confidence >= ${PARAMS.visibilityThreshold}
          and i.occurred_at >= now() - make_interval(secs => ${PARAMS.mapWindowMs / 1000})
          and i.geom && ST_Expand(lines.geom, ${PARAMS.influenceRadiusM / METERS_PER_DEGREE})
          and ST_DWithin(i.geom::geography, lines.geom::geography, ${PARAMS.influenceRadiusM})
      ) as nearby
    from lines
  `.execute(db);

  return alphas.map((_, index) => {
    const row = rows.find((candidate) => candidate.idx === index + 1);
    if (!row) return null;
    const line = JSON.parse(row.geojson) as { coordinates: [number, number][] };
    return {
      lengthM: row.length_m,
      riskScore: Math.min(1, row.risk_score ?? 0),
      nearbyIncidentIds: row.nearby ?? [],
      path: line.coordinates,
    };
  });
}

type VertexRow = { idx: number; id: string | null };

// Los dos vértices del grafo más cercanos a los puntos. La caché de rutas se apoya en ellos:
// el Dijkstra ya hace este ajuste, y repetirlo aquí evita calcular de nuevo el mismo par.
export async function nearestVertexIds(
  db: Db,
  from: LatLng,
  to: LatLng,
): Promise<{ fromId: string; toId: string } | null> {
  const { rows } = await sql<VertexRow>`
    select p.idx::int as idx, v.id::text as id
    from unnest(${[from.lng, to.lng]}::float8[], ${[from.lat, to.lat]}::float8[]) with ordinality as p(lng, lat, idx)
    left join lateral (
      select id from road_vertices
      order by geom <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
      limit 1
    ) v on true
  `.execute(db);

  const fromId = rows.find((row) => row.idx === 1)?.id;
  const toId = rows.find((row) => row.idx === 2)?.id;
  if (!fromId || !toId || fromId === toId) return null;
  return { fromId, toId };
}