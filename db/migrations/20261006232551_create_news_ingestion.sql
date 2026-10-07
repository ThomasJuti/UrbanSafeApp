-- migrate:up

-- M1, RN-09: cada artículo visto por la ingesta, con lo que se decidió sobre él. Sirve para
-- descartar duplicados exactos antes de llamar al LLM y para revisar la extracción a mano (§7).
create table news_articles (
  id bigint generated always as identity primary key,
  -- URL original del medio. Null cuando el enlace de Google News no se pudo decodificar.
  url text,
  google_link text,
  -- Título sin el " - Medio" que agrega Google, en minúsculas, sin tildes ni puntuación.
  normalized_title text not null,
  -- Dominio del medio sin "www."; Google News y el feed directo del mismo medio coinciden.
  media_key text not null,
  media_name text not null,
  title text not null,
  summary text not null,
  feed text not null,
  published_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'incident', 'discarded', 'failed')),
  discard_reason text,
  outcome text check (outcome in ('created', 'merged', 'duplicate')),
  incident_id uuid references incidents (id) on delete set null,
  attempts smallint not null default 0,
  last_error text,
  -- Lo que extrajo el LLM y lo que devolvió el geocodificador, para la revisión manual.
  extracted_type text,
  location_text text,
  geocode_kind text check (geocode_kind in ('point', 'neighborhood', 'locality', 'none')),
  occurred_at timestamptz,
  time_known boolean,
  first_seen_at timestamptz not null default now(),
  processed_at timestamptz,
  check (url is not null or google_link is not null)
);

-- RN-09, duplicado exacto: misma URL original, mismo enlace de Google o mismo título en el mismo medio.
create unique index news_articles_url_key on news_articles (url) where url is not null;
create unique index news_articles_google_link_key on news_articles (google_link) where google_link is not null;
create unique index news_articles_title_media_key on news_articles (normalized_title, media_key);
-- Solo unos pocos quedan pendientes o fallidos: la búsqueda de reintentos no recorre la tabla.
create index news_articles_retry_idx on news_articles (id) where status in ('pending', 'failed');
create index news_articles_processed_idx on news_articles (processed_at) where processed_at is not null;

-- Caché de geocodificación por texto de ubicación normalizado, también de los resultados vacíos.
-- Los términos de Google permiten guardar resultados de forma temporal (hasta 30 días); la vigencia
-- se controla al leer con params.newsIngestion.geocodeCacheTtlMs.
create table geocode_cache (
  query_key text primary key,
  result jsonb,
  cached_at timestamptz not null default now()
);

alter table news_articles enable row level security;
alter table geocode_cache enable row level security;

-- RN-09 para noticias, en una sola llamada como submit_community_report. Toma el mismo lock:
-- un reporte y una noticia del mismo hecho que llegan a la vez no pueden crear dos incidentes.
-- Los parámetros del spec llegan desde packages/shared.
create function submit_news_incident(
  p_article_id bigint,
  p_ref text,
  p_type text,
  p_severity smallint,
  p_location_kind text,
  p_location_name text,
  p_lng double precision,
  p_lat double precision,
  -- Polígono del barrio en GeoJSON; null si la ubicación es un punto o una localidad.
  p_area_geojson text,
  -- Código en locality_base_risk; null si no es una localidad.
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

  -- Las ventanas de tiempo van como rango, no con abs(...), para poder usar incidents_occurred_at_idx.

  -- La misma noticia ya es fuente de un incidente (otra consulta de Google, un reintento): no suma.
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
      -- Una localidad no absorbe ni es absorbida por contención (RN-09): solo se junta con otra
      -- noticia de la misma localidad, tipo compatible y menos de 24 h de diferencia.
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
      -- Un barrio que llega también es "el otro" de RN-09: contiene a los puntos que caen adentro.
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
      -- Se conserva el tipo de mayor gravedad (sección 4, tipos compatibles).
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

-- migrate:down
drop function submit_news_incident(bigint, text, text, smallint, text, text, double precision, double precision, text, text, timestamptz, boolean, real, text[], double precision, double precision, real, real);
drop table geocode_cache;
drop table news_articles;
