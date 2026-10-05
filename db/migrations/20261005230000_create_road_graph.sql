-- migrate:up
create extension if not exists pgrouting with schema extensions;

-- M5: el grafo de calles se recarga completo desde OSM (pnpm db:import-graph). Los ids de
-- vértice son los ids de nodo de OSM, así no hay que renumerar.
create table road_vertices (
  id bigint primary key,
  geom extensions.geometry(Point, 4326) not null
);
create index road_vertices_geom_idx on road_vertices using gist (geom);

create table road_edges (
  id bigint generated always as identity primary key,
  osm_way_id bigint not null,
  source bigint not null,
  target bigint not null,
  highway text not null,
  name text,
  length_m double precision not null check (length_m > 0),
  -- Convención de pgRouting: un costo negativo significa que ese sentido no se puede recorrer.
  cost_s double precision not null,
  reverse_cost_s double precision not null,
  geom extensions.geometry(LineString, 4326) not null
);
create index road_edges_geom_idx on road_edges using gist (geom);

alter table road_vertices enable row level security;
alter table road_edges enable row level security;

-- Devuelve los tramos de la ruta en orden, cada uno orientado en el sentido del recorrido.
-- Vacío si no hay ruta dentro de la caja recortada.
create function route_between(
  p_from_lng double precision,
  p_from_lat double precision,
  p_to_lng double precision,
  p_to_lat double precision,
  p_margin_m double precision
) returns table (seq integer, length_m double precision, geom extensions.geometry)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_from bigint;
  v_to bigint;
  -- Grados por metro cerca del ecuador. Bogotá está a 4,6°, así que el error es menor al 1 %.
  v_margin double precision := p_margin_m / 111320.0;
  v_edges_sql text;
begin
  select v.id into v_from from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_from_lng, p_from_lat), 4326) limit 1;
  select v.id into v_to from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_to_lng, p_to_lat), 4326) limit 1;
  if v_from is null or v_to is null or v_from = v_to then
    return;
  end if;

  v_edges_sql := format(
    'select id, source, target, cost_s as cost, reverse_cost_s as reverse_cost from road_edges
     where geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)',
    least(p_from_lng, p_to_lng) - v_margin,
    least(p_from_lat, p_to_lat) - v_margin,
    greatest(p_from_lng, p_to_lng) + v_margin,
    greatest(p_from_lat, p_to_lat) + v_margin
  );

  return query
  select d.seq, e.length_m, case when d.node = e.source then e.geom else ST_Reverse(e.geom) end
  from pgr_dijkstra(v_edges_sql, v_from, v_to, directed => true) d
  join road_edges e on e.id = d.edge
  order by d.seq;
end;
$$;

revoke execute on function route_between(double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- migrate:down
drop function route_between(double precision, double precision, double precision, double precision, double precision);
drop table road_edges;
drop table road_vertices;
drop extension if exists pgrouting;
