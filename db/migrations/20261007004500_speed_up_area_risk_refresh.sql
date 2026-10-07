-- migrate:up

-- Partir de los 46 000 tramos y probar cada uno contra el polígono tardaba 78 s en Ciudad
-- Bolívar, aunque ningún tramo cambiara. Partir del polígono y usar el índice GiST recorre
-- los mismos tramos en unos segundos. Los puntos siguen buscándose por el radio R.

create or replace function refresh_edge_risk(
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
  v_margin double precision := p_radius_m / 111320.0;
  v_area0 double precision := pi() * p_radius_m ^ 2;
  v_bands integer := 24 / p_band_hours;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtext('urbansafe:edge-risk'));

  with target as (
    select e.id from road_edges e where p_incident_ids is null
    union
    select e.id
    from incidents i
    join road_edges e on e.geom && ST_Expand(i.geom, v_margin)
    where i.id = any(p_incident_ids)
      and i.location_kind = 'point'
      and ST_DWithin(e.geom::geography, i.geom::geography, p_radius_m)
    union
    select e.id
    from incidents i
    join road_edges e on e.geom && i.geom
    where i.id = any(p_incident_ids)
      and i.location_kind <> 'point'
      and ST_Intersects(e.geom, i.geom)
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
    select id, sum(total) as total from (
      select e.id,
        l.weight * greatest(0, 1 - ST_Distance(e.geom::geography, l.geom::geography) / p_radius_m) as total
      from live l
      join road_edges e on l.location_kind = 'point'
        and e.geom && ST_Expand(l.geom, v_margin)
        and ST_DWithin(e.geom::geography, l.geom::geography, p_radius_m)
      join target t on t.id = e.id
      union all
      select e.id, l.weight * l.area_factor
      from live l
      join road_edges e on l.location_kind <> 'point'
        and e.geom && l.geom
        and ST_Intersects(e.geom, l.geom)
      join target t on t.id = e.id
    ) parts
    group by id
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

revoke execute on function refresh_edge_risk(uuid[], double precision, double precision, double precision, double precision, double precision, double precision, integer, real) from public, anon, authenticated;

-- migrate:down

create or replace function refresh_edge_risk(
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
  v_margin double precision := p_radius_m / 111320.0;
  v_area0 double precision := pi() * p_radius_m ^ 2;
  v_bands integer := 24 / p_band_hours;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtext('urbansafe:edge-risk'));

  with target as (
    select e.id from road_edges e where p_incident_ids is null
    union
    select e.id
    from incidents i
    join road_edges e on e.geom && ST_Expand(i.geom, v_margin)
    where i.id = any(p_incident_ids)
      and i.location_kind = 'point'
      and ST_DWithin(e.geom::geography, i.geom::geography, p_radius_m)
    union
    select e.id
    from incidents i
    join road_edges e on e.geom && i.geom
    where i.id = any(p_incident_ids)
      and i.location_kind <> 'point'
      and ST_Intersects(e.geom, i.geom)
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

revoke execute on function refresh_edge_risk(uuid[], double precision, double precision, double precision, double precision, double precision, double precision, integer, real) from public, anon, authenticated;
