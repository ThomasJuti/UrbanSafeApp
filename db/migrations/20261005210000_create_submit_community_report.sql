-- migrate:up

-- RN-09: busca el "mismo hecho". Una localidad nunca absorbe; un barrio sí si contiene el punto.
-- La ingesta de noticias (M1) también la va a usar.
create function find_matching_incident(
  p_point extensions.geometry,
  p_types text[],
  p_occurred_at timestamptz,
  p_max_distance_m double precision,
  p_max_gap_secs double precision
) returns uuid
language sql stable
set search_path = public, extensions
as $$
  select id
  from incidents
  where type = any (p_types)
    and abs(extract(epoch from (occurred_at - p_occurred_at))) < p_max_gap_secs
    and (
      (location_kind = 'point' and ST_DWithin(geom::geography, p_point::geography, p_max_distance_m))
      or (location_kind = 'neighborhood' and ST_Contains(geom, p_point))
    )
  order by ST_Distance(geom::geography, p_point::geography)
  limit 1
$$;

-- Todo el reporte comunitario en una sola llamada: con el API lejos de la base, cada consulta
-- suelta cuesta una ida y vuelta y el reporte no alcanzaba a llegar en menos de 1 s.
-- Los parámetros vienen de packages/shared para no duplicar valores del spec aquí.
create function submit_community_report(
  p_client_id uuid,
  p_device_id uuid,
  p_nickname text,
  p_type text,
  p_severity smallint,
  p_lng double precision,
  p_lat double precision,
  p_compatible_types text[],
  p_max_distance_m double precision,
  p_max_gap_secs double precision,
  p_rate_max integer,
  p_rate_window_secs double precision,
  p_initial_confidence real,
  p_confirm real,
  p_max_confidence real
) returns table (r_outcome text, r_incident_id uuid, r_replayed boolean)
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_point geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_incident uuid;
  v_outcome text;
begin
  -- Un solo lock para todos los reportes: serializa el límite por hora (RN-04) y la búsqueda
  -- del mismo hecho (RN-09). Cada sentencia de abajo ve lo que ya confirmó quien tenía el lock.
  perform pg_advisory_xact_lock(hashtext('urbansafe:community-reports'));

  select cr.outcome, cr.incident_id into v_outcome, v_incident
  from community_reports cr
  where cr.client_id = p_client_id;
  if found then
    return query select v_outcome, v_incident, true;
    return;
  end if;

  if (
    select count(*) from community_reports cr
    where cr.device_id = p_device_id
      and cr.created_at > now() - make_interval(secs => p_rate_window_secs)
  ) >= p_rate_max then
    return query select 'rate_limited'::text, null::uuid, false;
    return;
  end if;

  insert into reporters (device_id, nickname) values (p_device_id, p_nickname)
  on conflict (device_id) do update set nickname = excluded.nickname, updated_at = now();

  v_incident := find_matching_incident(v_point, p_compatible_types, now(), p_max_distance_m, p_max_gap_secs);

  if v_incident is null then
    insert into incidents (type, severity, location_kind, geom, occurred_at, time_known, confidence)
    values (p_type, p_severity, 'point', v_point, now(), true, p_initial_confidence)
    returning id into v_incident;
    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'community', p_device_id::text);
    v_outcome := 'created';
  else
    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'community', p_device_id::text)
    on conflict (incident_id, kind, ref) do nothing;
    if found then
      update incidents set confidence = least(p_max_confidence, confidence + p_confirm) where id = v_incident;
      v_outcome := 'confirmed';
    else
      v_outcome := 'already_counted';
    end if;
  end if;

  insert into community_reports (client_id, device_id, incident_id, outcome)
  values (p_client_id, p_device_id, v_incident, v_outcome);

  return query select v_outcome, v_incident, false;
end;
$$;

-- Supabase le da EXECUTE a anon y authenticated sobre toda función nueva en public, y la
-- expone por /rest/v1/rpc. Solo el API debe poder llamarlas.
revoke execute on function find_matching_incident(extensions.geometry, text[], timestamptz, double precision, double precision) from public, anon, authenticated;
revoke execute on function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real) from public, anon, authenticated;

-- migrate:down
drop function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real);
drop function find_matching_incident(extensions.geometry, text[], timestamptz, double precision, double precision);
