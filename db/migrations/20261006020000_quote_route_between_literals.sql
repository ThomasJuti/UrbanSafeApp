-- migrate:up

-- Mismo route_between, pero los valores entran al SQL de pgRouting como literales con su tipo
-- (%L::tipo) y no como texto pegado (%s). Hoy todos son numéricos y no hay forma de inyectar; así
-- sigue siendo seguro aunque algún parámetro cambie de tipo.
create or replace function route_between(
  p_from_lng double precision,
  p_from_lat double precision,
  p_to_lng double precision,
  p_to_lat double precision,
  p_margin_m double precision,
  p_alpha double precision,
  p_band integer
) returns table (seq integer, length_m double precision, risk real, geom extensions.geometry)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_from bigint;
  v_to bigint;
  -- Grados por metro cerca del ecuador. Bogotá está a 4,6°, así que el error es menor al 1 %.
  v_margin double precision := p_margin_m / 111320.0;
  v_slot integer := p_band + 1;
  v_edges_sql text;
begin
  select v.id into v_from from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_from_lng, p_from_lat), 4326) limit 1;
  select v.id into v_to from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_to_lng, p_to_lat), 4326) limit 1;
  if v_from is null or v_to is null or v_from = v_to then
    return;
  end if;

  -- El factor es positivo, así que los costos negativos (sentido prohibido) siguen negativos.
  v_edges_sql := format(
    'select id, source, target,
       cost_s * (1 + %1$L::float8 * risk[%2$L::integer]) as cost,
       reverse_cost_s * (1 + %1$L::float8 * risk[%2$L::integer]) as reverse_cost
     from road_edges
     where geom && ST_MakeEnvelope(%3$L::float8, %4$L::float8, %5$L::float8, %6$L::float8, 4326)',
    p_alpha,
    v_slot,
    least(p_from_lng, p_to_lng) - v_margin,
    least(p_from_lat, p_to_lat) - v_margin,
    greatest(p_from_lng, p_to_lng) + v_margin,
    greatest(p_from_lat, p_to_lat) + v_margin
  );

  return query
  select d.seq, e.length_m, e.risk[v_slot], case when d.node = e.source then e.geom else ST_Reverse(e.geom) end
  from pgr_dijkstra(v_edges_sql, v_from, v_to, directed => true) d
  join road_edges e on e.id = d.edge
  order by d.seq;
end;
$$;

revoke execute on function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;

-- migrate:down

create or replace function route_between(
  p_from_lng double precision,
  p_from_lat double precision,
  p_to_lng double precision,
  p_to_lat double precision,
  p_margin_m double precision,
  p_alpha double precision,
  p_band integer
) returns table (seq integer, length_m double precision, risk real, geom extensions.geometry)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_from bigint;
  v_to bigint;
  v_margin double precision := p_margin_m / 111320.0;
  v_slot integer := p_band + 1;
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
    'select id, source, target,
       cost_s * (1 + %1$s * risk[%2$s]) as cost,
       reverse_cost_s * (1 + %1$s * risk[%2$s]) as reverse_cost
     from road_edges
     where geom && ST_MakeEnvelope(%3$s, %4$s, %5$s, %6$s, 4326)',
    p_alpha,
    v_slot,
    least(p_from_lng, p_to_lng) - v_margin,
    least(p_from_lat, p_to_lat) - v_margin,
    greatest(p_from_lng, p_to_lng) + v_margin,
    greatest(p_from_lat, p_to_lat) + v_margin
  );

  return query
  select d.seq, e.length_m, e.risk[v_slot], case when d.node = e.source then e.geom else ST_Reverse(e.geom) end
  from pgr_dijkstra(v_edges_sql, v_from, v_to, directed => true) d
  join road_edges e on e.id = d.edge
  order by d.seq;
end;
$$;

revoke execute on function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
