-- migrate:up
-- M4: el riesgo de cada tramo queda precalculado para las franjas de RN-11, así el Dijkstra
-- solo multiplica (RN-07) en vez de calcular el riesgo por tramo en cada ruta.
alter table road_edges
  add column locality_code text,
  add column recent_risk real not null default 0 check (recent_risk between 0 and 1),
  add column risk real[] not null default '{0,0,0,0}';
create index road_edges_locality_code_idx on road_edges (locality_code);

create table locality_time_multipliers (
  locality_code text not null,
  band smallint not null check (band >= 0),
  multiplier real not null check (multiplier > 0),
  primary key (locality_code, band)
);
alter table locality_time_multipliers enable row level security;

-- Localidad de cada tramo según su punto medio. Correr después de importar el grafo o el
-- riesgo base.
create function assign_edge_localities() returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_updated integer;
begin
  with assigned as (
    select e.id,
      (select l.code from locality_base_risk l
       where ST_Intersects(l.geom, ST_LineInterpolatePoint(e.geom, 0.5)) limit 1) as code
    from road_edges e
  )
  update road_edges e set locality_code = a.code
  from assigned a
  where e.id = a.id and e.locality_code is distinct from a.code;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- RN-11. Las localidades sin suficientes incidentes con hora quedan sin fila, que equivale a m = 1.
create function refresh_time_multipliers(
  p_window_secs double precision,
  p_min_incidents integer,
  p_min double precision,
  p_max double precision,
  p_band_hours integer,
  p_time_zone text,
  p_visibility_threshold real
) returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_bands integer := 24 / p_band_hours;
begin
  delete from locality_time_multipliers;

  insert into locality_time_multipliers (locality_code, band, multiplier)
  with located as (
    select l.code,
      floor(extract(hour from i.occurred_at at time zone p_time_zone) / p_band_hours)::smallint as band
    from incidents i
    join locality_base_risk l on ST_Intersects(l.geom, ST_PointOnSurface(i.geom))
    where i.time_known
      and i.confidence >= p_visibility_threshold
      and i.occurred_at >= now() - make_interval(secs => p_window_secs)
  ),
  totals as (
    select code, count(*) as total from located group by code having count(*) >= p_min_incidents
  )
  select t.code, b.band,
    least(p_max, greatest(p_min, v_bands * count(lo.code)::double precision / t.total))
  from totals t
  cross join generate_series(0, v_bands - 1) as b(band)
  left join located lo on lo.code = t.code and lo.band = b.band
  group by t.code, b.band, t.total;
end;
$$;

-- RN-06 y RN-10. Con p_incident_ids recalcula solo los tramos cerca de esos incidentes; con null,
-- toda la ciudad (para el decaimiento y cuando cambian el riesgo base o los multiplicadores).
-- Devuelve cuántos tramos cambiaron; los que quedan igual no se reescriben.
create function refresh_edge_risk(
  p_incident_ids uuid[],
  p_radius_m double precision,
  p_tau_secs double precision,
  p_window_secs double precision,
  p_saturation_k double precision,
  p_w_base double precision,
  p_w_recent double precision,
  p_band_hours integer,
  p_visibility_threshold real
) returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  -- Grados por metro cerca del ecuador, como en route_between. Solo sirve de prefiltro para el
  -- índice; la distancia real se mide con geography.
  v_margin double precision := p_radius_m / 111320.0;
  v_area0 double precision := pi() * p_radius_m ^ 2;
  v_bands integer := 24 / p_band_hours;
  v_updated integer;
begin
  -- Dos recálculos a la vez se pisarían; el segundo espera al primero.
  perform pg_advisory_xact_lock(hashtext('urbansafe:edge-risk'));

  with target as (
    select e.id from road_edges e where p_incident_ids is null
    union
    select e.id
    from incidents i
    join road_edges e on e.geom && ST_Expand(i.geom, v_margin)
    where i.id = any(p_incident_ids)
      and ST_DWithin(e.geom::geography, i.geom::geography, p_radius_m)
  ),
  live as (
    select i.geom, i.location_kind,
      i.severity * i.confidence * exp(-greatest(0, extract(epoch from now() - i.occurred_at)) / p_tau_secs) as weight,
      case when i.location_kind <> 'point' then least(1, v_area0 / nullif(ST_Area(i.geom::geography), 0)) end as area_factor
    from incidents i
    where i.confidence >= p_visibility_threshold
      and i.occurred_at >= now() - make_interval(secs => p_window_secs)
  ),
  contributions as (
    select t.id,
      sum(case when l.location_kind = 'point'
        then l.weight * greatest(0, 1 - ST_Distance(e.geom::geography, l.geom::geography) / p_radius_m)
        else l.weight * l.area_factor end) as total
    from target t
    join road_edges e on e.id = t.id
    join live l on e.geom && ST_Expand(l.geom, v_margin)
      and case when l.location_kind = 'point'
        then ST_DWithin(e.geom::geography, l.geom::geography, p_radius_m)
        else ST_Intersects(e.geom, l.geom) end
    group by t.id
  ),
  multipliers as (
    select l.code, array_agg(coalesce(m.multiplier, 1)::double precision order by b.band) as by_band
    from locality_base_risk l
    cross join generate_series(0, v_bands - 1) as b(band)
    left join locality_time_multipliers m on m.locality_code = l.code and m.band = b.band
    group by l.code
  ),
  computed as (
    select t.id, (1 - exp(-coalesce(c.total, 0) / p_saturation_k))::real as recent
    from target t
    left join contributions c on c.id = t.id
  ),
  next as (
    select c.id, c.recent,
      array(
        select least(1, (p_w_base * coalesce(b.base_risk, 0) + p_w_recent * c.recent) * coalesce(m.by_band[band], 1))::real
        from generate_series(1, v_bands) as band
        order by band
      ) as risk
    from computed c
    join road_edges e on e.id = c.id
    left join locality_base_risk b on b.code = e.locality_code
    left join multipliers m on m.code = e.locality_code
  )
  update road_edges e set recent_risk = n.recent, risk = n.risk
  from next n
  where e.id = n.id and (e.recent_risk is distinct from n.recent or e.risk is distinct from n.risk);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- RN-07: costo = tiempo × (1 + α · riesgo(tramo, franja)). p_band empieza en 0, como en RN-11.
drop function route_between(double precision, double precision, double precision, double precision, double precision);

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

revoke execute on function assign_edge_localities() from public, anon, authenticated;
revoke execute on function refresh_time_multipliers(double precision, integer, double precision, double precision, integer, text, real) from public, anon, authenticated;
revoke execute on function refresh_edge_risk(uuid[], double precision, double precision, double precision, double precision, double precision, double precision, integer, real) from public, anon, authenticated;
revoke execute on function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;

-- migrate:down
drop function route_between(double precision, double precision, double precision, double precision, double precision, double precision, integer);

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

drop function refresh_edge_risk(uuid[], double precision, double precision, double precision, double precision, double precision, double precision, integer, real);
drop function refresh_time_multipliers(double precision, integer, double precision, double precision, integer, text, real);
drop function assign_edge_localities();
drop table locality_time_multipliers;
alter table road_edges drop column risk, drop column recent_risk, drop column locality_code;
