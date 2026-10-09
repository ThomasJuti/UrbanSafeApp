-- migrate:up

-- RN-13: route_between acepta una lista de tramos a evitar y el recargo que se les suma al costo.
-- El recargo es multiplicativo y positivo, así que los costos negativos (sentido prohibido) siguen
-- negativos. No es un bloqueo: si no hay otra salida, la ruta igual pasa por ahí.
drop function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer);

create function route_between(
  p_from_lng double precision,
  p_from_lat double precision,
  p_to_lng double precision,
  p_to_lat double precision,
  p_margin_m double precision,
  p_alpha double precision,
  p_band integer,
  p_avoid_edges bigint[],
  p_avoid_factor double precision
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
  v_avoid_sql text := '1';
  v_edges_sql text;
begin
  select v.id into v_from from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_from_lng, p_from_lat), 4326) limit 1;
  select v.id into v_to from road_vertices v
  order by v.geom <-> ST_SetSRID(ST_MakePoint(p_to_lng, p_to_lat), 4326) limit 1;
  if v_from is null or v_to is null or v_from = v_to then
    return;
  end if;

  -- Sin tramos o sin recargo el término es 1 y no se evalúa nada por tramo.
  if coalesce(cardinality(p_avoid_edges), 0) > 0 and coalesce(p_avoid_factor, 0) > 0 then
    v_avoid_sql := format('(case when id = any(%L::bigint[]) then 1 + %L::float8 else 1 end)', p_avoid_edges, p_avoid_factor);
  end if;

  v_edges_sql := format(
    'select id, source, target,
       cost_s * (1 + %1$L::float8 * risk[%2$L::integer]) * %7$s as cost,
       reverse_cost_s * (1 + %1$L::float8 * risk[%2$L::integer]) * %7$s as reverse_cost
     from road_edges
     where geom && ST_MakeEnvelope(%3$L::float8, %4$L::float8, %5$L::float8, %6$L::float8, 4326)',
    p_alpha,
    v_slot,
    least(p_from_lng, p_to_lng) - v_margin,
    least(p_from_lat, p_to_lat) - v_margin,
    greatest(p_from_lng, p_to_lng) + v_margin,
    greatest(p_from_lat, p_to_lat) + v_margin,
    v_avoid_sql
  );

  return query
  select d.seq, e.length_m, e.risk[v_slot], case when d.node = e.source then e.geom else ST_Reverse(e.geom) end
  from pgr_dijkstra(v_edges_sql, v_from, v_to, directed => true) d
  join road_edges e on e.id = d.edge
  order by d.seq;
end;
$$;

revoke execute on function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer, bigint[], double precision) from public, anon, authenticated;

-- migrate:down

drop function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer, bigint[], double precision);

create function route_between(
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
