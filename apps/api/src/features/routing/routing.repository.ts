import { PARAMS, type HotIncident, type LatLng, type RiskLevel, type RouteSegment } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

// Cerca del ecuador; solo sirve de prefiltro para el índice, la distancia real va en geography.
const METERS_PER_DEGREE = 111_320;

export type RoutePath = {
  lengthM: number;
  riskScore: number;
  nearbyIncidentIds: string[];
  path: [number, number][];
  segments: RouteSegment[];
  hotIncidents: HotIncident[];
};

// `avoidFactors` va alineado con `alphas`: el recargo de RN-13 que lleva cada ruta (0 = ninguno).
export type RoutesQuery = {
  from: LatLng;
  to: LatLng;
  marginM: number;
  alphas: readonly number[];
  avoidFactors: readonly number[];
  band: number;
};

type Row = {
  idx: number;
  length_m: number;
  risk_score: number | null;
  geojson: string;
  nearby: string[] | null;
  segments: { level: RiskLevel; geojson: { coordinates: [number, number][] } }[] | null;
  hot: HotIncident[];
};

// Una ruta por α, en el mismo orden. Null en la posición de la que no tenga camino dentro de la caja.
// Van en serie dentro de una sola consulta: el Dijkstra es pura CPU y en paralelo se estorban
// hasta tardar más que en serie.
// Con velocidad fija, ponderar por longitud es lo mismo que ponderar por tiempo de recorrido (M5).
export async function queryRoutes(
  db: Db,
  { from, to, marginM, alphas, avoidFactors, band }: RoutesQuery,
): Promise<(RoutePath | null)[]> {
  const { low, high } = PARAMS.routeRiskLevels;
  const { minSeverity, minConfidence, radiusM } = PARAMS.avoidZone;
  const { reportedWithinMs, occurredWithinMs } = PARAMS.alertWindow;
  // Los incidentes que pueden tocar un tramo de la caja de ruteo: la caja más el radio de la zona.
  const reach = (marginM + radiusM) / METERS_PER_DEGREE;
  const box = [
    Math.min(from.lng, to.lng) - reach,
    Math.min(from.lat, to.lat) - reach,
    Math.max(from.lng, to.lng) + reach,
    Math.max(from.lat, to.lat) + reach,
  ];
  const now = Date.now();
  const reportedSince = new Date(now - reportedWithinMs);
  const occurredSince = new Date(now - occurredWithinMs);

  const { rows } = await sql<Row>`
    with hot as (
      -- RN-13: zonas a evitar. Una localidad es demasiado grande para penalizarla entera.
      select i.id, i.type, i.location_kind, i.geom
      from incidents i
      where i.severity >= ${minSeverity}
        and i.confidence >= ${Math.max(minConfidence, PARAMS.visibilityThreshold)}
        and i.location_kind <> 'locality'
        and i.reported_at >= ${reportedSince}
        and i.occurred_at >= ${occurredSince}
        and i.geom && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
    ),
    hot_edges as (
      select coalesce(array_agg(distinct e.id), '{}'::bigint[]) as ids
      from road_edges e
      join hot h on e.geom && ST_Expand(h.geom, ${radiusM / METERS_PER_DEGREE})
        and case when h.location_kind = 'point'
          then ST_DWithin(e.geom::geography, h.geom::geography, ${radiusM})
          else ST_Intersects(e.geom, h.geom) end
    ),
    steps as (
      select a.idx::int as idx, r.*
      from unnest(${alphas}::float8[], ${avoidFactors}::float8[]) with ordinality as a(alpha, factor, idx)
      cross join hot_edges
      cross join lateral route_between(${from.lng}, ${from.lat}, ${to.lng}, ${to.lat}, ${marginM}, a.alpha, ${band}::integer, hot_edges.ids, a.factor) r
    ),
    levelled as (
      select idx, seq, geom,
        case when coalesce(risk, 0) < ${low} then 'low' when coalesce(risk, 0) < ${high} then 'medium' else 'high' end as level
      from steps
    ),
    -- Islas: tramos consecutivos del mismo nivel comparten seq - row_number().
    runs as (
      select idx, seq, geom, level,
        seq - row_number() over (partition by idx, level order by seq) as run
      from levelled
    ),
    segments as (
      select idx, level, min(seq) as first_seq, ST_MakeLine(geom order by seq) as geom
      from runs
      group by idx, run, level
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
      ) as nearby,
      (
        select json_agg(json_build_object('level', s.level, 'geojson', ST_AsGeoJSON(s.geom, 6)::json) order by s.first_seq)
        from segments s where s.idx = lines.idx
      ) as segments,
      (
        select coalesce(json_agg(json_build_object('id', h.id, 'type', h.type)), '[]'::json)
        from hot h
        where h.geom && ST_Expand(lines.geom, ${radiusM / METERS_PER_DEGREE})
          and case when h.location_kind = 'point'
            then ST_DWithin(h.geom::geography, lines.geom::geography, ${radiusM})
            else ST_Intersects(h.geom, lines.geom) end
      ) as hot
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
      segments: (row.segments ?? []).map((segment) => ({ level: segment.level, path: segment.geojson.coordinates })),
      hotIncidents: row.hot,
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