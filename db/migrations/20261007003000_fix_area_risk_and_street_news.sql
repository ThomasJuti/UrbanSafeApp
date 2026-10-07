-- migrate:up

-- RN-10: un área solo aporta a los tramos que caen adentro. Medir ST_DWithin(geography) contra
-- el polígono de una localidad (Ciudad Bolívar, ~130 km²) tardaba ~44 s por incidente; cuatro
-- localidades de una corrida de noticias sumaban los ~110 s. ST_Intersects usa el índice y
-- tarda decenas de milisegundos. El punto sigue usando el radio R.

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

-- Nombre de vía comparable: minúsculas y sin tildes. No se le quita "avenida": "Calle 26" del
-- occidente y "Avenida Calle 26" no son la misma vía.
create function street_name_key(p_name text) returns text
language sql immutable
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(translate(lower(btrim(p_name)), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g'), '');
$$;

-- La vía de OSM que corresponde al nombre de Google. Si "Calle 26" y "Avenida Calle 26" existen,
-- gana la que tiene más tramos. Si el nombre no está (Avenida El Dorado), se usa la vía con
-- nombre más cercana al punto, dentro de p_snap_m.
create function resolve_street_key(p_name text, p_point geometry, p_snap_m double precision) returns text
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_key text := street_name_key(p_name);
  v_best text;
  v_near text;
  v_dist double precision;
begin
  select c.key into v_best
  from (
    select v_key as key
    union all
    select 'avenida ' || v_key where v_key is not null and v_key not like 'avenida %'
  ) c
  join road_edges e on street_name_key(e.name) = c.key
  group by c.key
  order by count(*) desc
  limit 1;

  if v_best is not null then
    return v_best;
  end if;

  select street_name_key(e.name), ST_Distance(e.geom::geography, p_point::geography)
    into v_near, v_dist
  from road_edges e
  where e.name is not null
  order by e.geom <-> p_point
  limit 1;

  if v_near is null or v_dist > p_snap_m then
    return null;
  end if;

  select c.key into v_best
  from (
    select v_near as key
    union all
    select 'avenida ' || v_near where v_near not like 'avenida %'
  ) c
  join road_edges e on street_name_key(e.name) = c.key
  group by c.key
  order by count(*) desc
  limit 1;

  return v_best;
end;
$$;

create index road_edges_street_key_idx on road_edges (street_name_key(name)) where name is not null;

alter table incidents drop constraint incidents_location_kind_check;
alter table incidents add constraint incidents_location_kind_check
  check (location_kind in ('point', 'neighborhood', 'locality', 'street'));

alter table incidents drop constraint incidents_location_shape;
alter table incidents add constraint incidents_location_shape check (
  (location_kind = 'point' and ST_GeometryType(geom) = 'ST_Point')
  or (
    location_kind in ('neighborhood', 'locality', 'street')
    and ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon')
    and location_name is not null
  )
);

alter table news_articles drop constraint news_articles_geocode_kind_check;
alter table news_articles add constraint news_articles_geocode_kind_check
  check (geocode_kind in ('point', 'neighborhood', 'locality', 'street', 'none'));

-- Un "no encontrado" cacheado puede ser una vía larga que el clasificador anterior rechazó.
delete from geocode_cache where result is null;

drop function submit_news_incident(bigint, text, text, smallint, text, text, double precision, double precision, text, text, timestamptz, boolean, real, text[], double precision, double precision, real, real);

create function submit_news_incident(
  p_article_id bigint,
  p_ref text,
  p_type text,
  p_severity smallint,
  p_location_kind text,
  p_location_name text,
  p_lng double precision,
  p_lat double precision,
  p_area_geojson text,
  p_locality_code text,
  p_occurred_at timestamptz,
  p_time_known boolean,
  p_confidence real,
  p_compatible_types text[],
  p_max_distance_m double precision,
  p_max_gap_secs double precision,
  p_merge real,
  p_max_confidence real,
  p_street_buffer_m double precision,
  p_street_snap_m double precision
) returns table (r_outcome text, r_incident_id uuid)
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_point geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_geom geometry;
  v_name text := p_location_name;
  v_key text;
  v_incident uuid;
  v_outcome text;
begin
  perform pg_advisory_xact_lock(hashtext('urbansafe:community-reports'));

  select s.incident_id into v_incident
  from incident_sources s
  where s.kind = 'news' and s.ref = p_ref
  limit 1;

  if v_incident is not null then
    v_outcome := 'duplicate';
  else
    if p_location_kind = 'point' then
      v_geom := v_point;
    elsif p_location_kind = 'neighborhood' then
      v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_area_geojson), 4326);
    elsif p_location_kind = 'locality' then
      select l.geom, l.name into v_geom, v_name from locality_base_risk l where l.code = p_locality_code;
      if v_geom is null then
        update news_articles
        set status = 'discarded', discard_reason = 'locality_unmatched', processed_at = now()
        where id = p_article_id;
        return query select 'locality_unmatched'::text, null::uuid;
        return;
      end if;
      v_point := ST_PointOnSurface(v_geom);
    elsif p_location_kind = 'street' then
      -- Corredor angosto de la vía. No se guarda la caja de Google: cubriría media ciudad y
      -- el recálculo de riesgo volvería a recorrer decenas de miles de tramos.
      v_key := resolve_street_key(p_location_name, v_point, p_street_snap_m);
      if v_key is null then
        update news_articles
        set status = 'discarded', discard_reason = 'street_unmatched', processed_at = now()
        where id = p_article_id;
        return query select 'street_unmatched'::text, null::uuid;
        return;
      end if;
      select e.name into v_name
      from road_edges e
      where street_name_key(e.name) = v_key
      group by e.name
      order by count(*) desc, e.name
      limit 1;
      select ST_Multi(ST_Buffer(ST_Collect(e.geom)::geography, p_street_buffer_m)::geometry)
        into v_geom
      from road_edges e
      where street_name_key(e.name) = v_key;
      v_point := ST_PointOnSurface(v_geom);
    else
      raise exception 'location_kind desconocido: %', p_location_kind;
    end if;

    if p_location_kind = 'street' then
      -- Dos notas que solo dicen la misma vía son el mismo corredor. No se absorbe un punto
      -- que caiga encima: la vía es demasiado larga para asumir que es el mismo hecho (RN-09).
      select i.id into v_incident
      from incidents i
      where i.location_kind = 'street'
        and street_name_key(i.location_name) = street_name_key(v_name)
        and i.type = any (p_compatible_types)
        and i.occurred_at > p_occurred_at - make_interval(secs => p_max_gap_secs)
        and i.occurred_at < p_occurred_at + make_interval(secs => p_max_gap_secs)
      order by i.occurred_at desc
      limit 1;
    elsif p_location_kind = 'locality' then
      -- RN-09: una localidad es demasiado grande para tratar dos noticias como el mismo hecho.
      v_incident := null;
    else
      v_incident := find_matching_incident(v_point, p_compatible_types, p_occurred_at, p_max_distance_m, p_max_gap_secs);
      if v_incident is null and p_location_kind = 'neighborhood' then
        select i.id into v_incident
        from incidents i
        where i.location_kind = 'point'
          and i.type = any (p_compatible_types)
          and i.occurred_at > p_occurred_at - make_interval(secs => p_max_gap_secs)
          and i.occurred_at < p_occurred_at + make_interval(secs => p_max_gap_secs)
          and ST_Contains(v_geom, i.geom)
        order by ST_Distance(i.geom::geography, v_point::geography)
        limit 1;
      end if;
    end if;

    if v_incident is null then
      insert into incidents (type, severity, location_kind, location_name, geom, occurred_at, time_known, confidence)
      values (
        p_type, p_severity, p_location_kind,
        case when p_location_kind = 'point' then null else v_name end,
        v_geom, p_occurred_at, p_time_known, p_confidence
      )
      returning id into v_incident;
      v_outcome := 'created';
    else
      update incidents
      set confidence = least(p_max_confidence, confidence + p_merge),
        type = case when p_severity > severity then p_type else type end,
        severity = greatest(severity, p_severity)
      where id = v_incident;
      v_outcome := 'merged';
    end if;

    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'news', p_ref);
  end if;

  update news_articles
  set status = 'incident', outcome = v_outcome, incident_id = v_incident, processed_at = now()
  where id = p_article_id;

  return query select v_outcome, v_incident;
end;
$$;

revoke execute on function street_name_key(text) from public, anon, authenticated;
revoke execute on function resolve_street_key(text, geometry, double precision) from public, anon, authenticated;
revoke execute on function submit_news_incident(bigint, text, text, smallint, text, text, double precision, double precision, text, text, timestamptz, boolean, real, text[], double precision, double precision, real, real, double precision, double precision) from public, anon, authenticated;

-- migrate:down

drop function submit_news_incident(bigint, text, text, smallint, text, text, double precision, double precision, text, text, timestamptz, boolean, real, text[], double precision, double precision, real, real, double precision, double precision);

create function submit_news_incident(
  p_article_id bigint,
  p_ref text,
  p_type text,
  p_severity smallint,
  p_location_kind text,
  p_location_name text,
  p_lng double precision,
  p_lat double precision,
  p_area_geojson text,
  p_locality_code text,
  p_occurred_at timestamptz,
  p_time_known boolean,
  p_confidence real,
  p_compatible_types text[],
  p_max_distance_m double precision,
  p_max_gap_secs double precision,
  p_merge real,
  p_max_confidence real
) returns table (r_outcome text, r_incident_id uuid)
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_point geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_geom geometry;
  v_name text := p_location_name;
  v_incident uuid;
  v_outcome text;
begin
  perform pg_advisory_xact_lock(hashtext('urbansafe:community-reports'));

  select s.incident_id into v_incident
  from incident_sources s
  where s.kind = 'news' and s.ref = p_ref
  limit 1;

  if v_incident is not null then
    v_outcome := 'duplicate';
  else
    if p_location_kind = 'point' then
      v_geom := v_point;
    elsif p_location_kind = 'neighborhood' then
      v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_area_geojson), 4326);
    elsif p_location_kind = 'locality' then
      select l.geom, l.name into v_geom, v_name from locality_base_risk l where l.code = p_locality_code;
      if v_geom is null then
        update news_articles
        set status = 'discarded', discard_reason = 'locality_unmatched', processed_at = now()
        where id = p_article_id;
        return query select 'locality_unmatched'::text, null::uuid;
        return;
      end if;
      v_point := ST_PointOnSurface(v_geom);
    else
      raise exception 'location_kind desconocido: %', p_location_kind;
    end if;

    if p_location_kind = 'locality' then
      select i.id into v_incident
      from incidents i
      where i.location_kind = 'locality'
        and i.location_name = v_name
        and i.type = any (p_compatible_types)
        and i.occurred_at > p_occurred_at - make_interval(secs => p_max_gap_secs)
        and i.occurred_at < p_occurred_at + make_interval(secs => p_max_gap_secs)
      order by abs(extract(epoch from (i.occurred_at - p_occurred_at)))
      limit 1;
    else
      v_incident := find_matching_incident(v_point, p_compatible_types, p_occurred_at, p_max_distance_m, p_max_gap_secs);
      if v_incident is null and p_location_kind = 'neighborhood' then
        select i.id into v_incident
        from incidents i
        where i.location_kind = 'point'
          and i.type = any (p_compatible_types)
          and i.occurred_at > p_occurred_at - make_interval(secs => p_max_gap_secs)
          and i.occurred_at < p_occurred_at + make_interval(secs => p_max_gap_secs)
          and ST_Contains(v_geom, i.geom)
        order by ST_Distance(i.geom::geography, v_point::geography)
        limit 1;
      end if;
    end if;

    if v_incident is null then
      insert into incidents (type, severity, location_kind, location_name, geom, occurred_at, time_known, confidence)
      values (
        p_type, p_severity, p_location_kind,
        case when p_location_kind = 'point' then null else v_name end,
        v_geom, p_occurred_at, p_time_known, p_confidence
      )
      returning id into v_incident;
      v_outcome := 'created';
    else
      update incidents
      set confidence = least(p_max_confidence, confidence + p_merge),
        type = case when p_severity > severity then p_type else type end,
        severity = greatest(severity, p_severity)
      where id = v_incident;
      v_outcome := 'merged';
    end if;

    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'news', p_ref);
  end if;

  update news_articles
  set status = 'incident', outcome = v_outcome, incident_id = v_incident, processed_at = now()
  where id = p_article_id;

  return query select v_outcome, v_incident;
end;
$$;

revoke execute on function submit_news_incident(bigint, text, text, smallint, text, text, double precision, double precision, text, text, timestamptz, boolean, real, text[], double precision, double precision, real, real) from public, anon, authenticated;

drop index road_edges_street_key_idx;
drop function resolve_street_key(text, geometry, double precision);
drop function street_name_key(text);

alter table news_articles drop constraint news_articles_geocode_kind_check;
alter table news_articles add constraint news_articles_geocode_kind_check
  check (geocode_kind in ('point', 'neighborhood', 'locality', 'none'));

alter table incidents drop constraint incidents_location_kind_check;
alter table incidents add constraint incidents_location_kind_check
  check (location_kind in ('point', 'neighborhood', 'locality'));

alter table incidents drop constraint incidents_location_shape;
alter table incidents add constraint incidents_location_shape check (
  (location_kind = 'point' and ST_GeometryType(geom) = 'ST_Point')
  or (
    location_kind in ('neighborhood', 'locality')
    and ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon')
    and location_name is not null
  )
);

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

revoke execute on function refresh_edge_risk(uuid[], double precision, double precision, double precision, double precision, double precision, double precision, integer, real) from public, anon, authenticated;
