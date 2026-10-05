-- migrate:up

-- RN-04: un voto por usuario e incidente lo garantiza la llave primaria, no el código.
create table incident_votes (
  device_id uuid not null references reporters (device_id),
  incident_id uuid not null references incidents (id) on delete cascade,
  vote text not null check (vote in ('confirm', 'deny')),
  created_at timestamptz not null default now(),
  primary key (device_id, incident_id)
);
create index incident_votes_incident_idx on incident_votes (incident_id);
alter table incident_votes enable row level security;

-- RN-04: confirmaciones menos negaciones que recibieron sus incidentes. Se lleva como contador
-- para no recorrer su historial en cada reporte.
alter table reporters add column vote_balance integer not null default 0;

create function credit_community_sources(p_incident_id uuid, p_except_device uuid, p_delta integer)
returns void
language sql volatile
set search_path = public, extensions
as $$
  update reporters r
  set vote_balance = r.vote_balance + p_delta
  from incident_sources s
  where s.incident_id = p_incident_id
    and s.kind = 'community'
    -- El case evita castear a uuid los ref de noticias, que son URLs.
    and r.device_id = case when s.kind = 'community' then s.ref::uuid end
    and r.device_id <> p_except_device
$$;

-- Votos y reportes toman el mismo lock: así un voto y un reporte simultáneos del mismo
-- usuario sobre el mismo incidente no cuentan los dos.
create function cast_incident_vote(
  p_device_id uuid,
  p_nickname text,
  p_incident_id uuid,
  p_vote text,
  p_delta real,
  p_max_confidence real,
  p_visibility_threshold real,
  p_map_window_secs double precision
) returns table (r_outcome text, r_replayed boolean)
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_existing text;
begin
  perform pg_advisory_xact_lock(hashtext('urbansafe:community-reports'));

  select v.vote into v_existing
  from incident_votes v
  where v.device_id = p_device_id and v.incident_id = p_incident_id;
  if found then
    -- El mismo voto otra vez es un reintento del cliente, no un error.
    if v_existing = p_vote then
      return query select 'counted'::text, true;
    else
      return query select 'already_voted'::text, false;
    end if;
    return;
  end if;

  if exists (
    select 1 from incident_sources s
    where s.incident_id = p_incident_id and s.kind = 'community' and s.ref = p_device_id::text
  ) then
    return query select 'own_report'::text, false;
    return;
  end if;

  -- RN-12: solo se vota lo que el mapa muestra.
  if not exists (
    select 1 from incidents i
    where i.id = p_incident_id
      and i.confidence >= p_visibility_threshold
      and i.occurred_at >= now() - make_interval(secs => p_map_window_secs)
  ) then
    return query select 'not_available'::text, false;
    return;
  end if;

  insert into reporters (device_id, nickname) values (p_device_id, p_nickname)
  on conflict (device_id) do update set nickname = excluded.nickname, updated_at = now();

  insert into incident_votes (device_id, incident_id, vote) values (p_device_id, p_incident_id, p_vote);

  update incidents
  set confidence = greatest(0, least(p_max_confidence, confidence + p_delta))
  where id = p_incident_id;

  perform credit_community_sources(p_incident_id, p_device_id, case when p_vote = 'confirm' then 1 else -1 end);

  return query select 'counted'::text, false;
end;
$$;

drop function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real);

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
  p_base_confidence real,
  p_reputation_step real,
  p_max_initial_confidence real,
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
  v_balance integer;
begin
  -- Un solo lock para reportes y votos: serializa el límite por hora (RN-04), la búsqueda del
  -- mismo hecho (RN-09) y el voto único. Cada sentencia ve lo que confirmó quien tenía el lock.
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
  on conflict (device_id) do update set nickname = excluded.nickname, updated_at = now()
  returning vote_balance into v_balance;

  v_incident := find_matching_incident(v_point, p_compatible_types, now(), p_max_distance_m, p_max_gap_secs);

  if v_incident is null then
    insert into incidents (type, severity, location_kind, geom, occurred_at, time_known, confidence)
    values (
      p_type, p_severity, 'point', v_point, now(), true,
      least(p_max_initial_confidence, p_base_confidence + p_reputation_step * greatest(0, v_balance))
    )
    returning id into v_incident;
    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'community', p_device_id::text);
    v_outcome := 'created';
  elsif exists (
    select 1 from incident_votes v where v.device_id = p_device_id and v.incident_id = v_incident
  ) then
    v_outcome := 'already_counted';
  else
    insert into incident_sources (incident_id, kind, ref) values (v_incident, 'community', p_device_id::text)
    on conflict (incident_id, kind, ref) do nothing;
    if found then
      update incidents set confidence = least(p_max_confidence, confidence + p_confirm) where id = v_incident;
      perform credit_community_sources(v_incident, p_device_id, 1);
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

revoke execute on function credit_community_sources(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function cast_incident_vote(uuid, text, uuid, text, real, real, real, double precision) from public, anon, authenticated;
revoke execute on function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real, real, real) from public, anon, authenticated;

-- migrate:down
drop function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real, real, real);
drop function cast_incident_vote(uuid, text, uuid, text, real, real, real, double precision);
drop function credit_community_sources(uuid, uuid, integer);
alter table reporters drop column vote_balance;
drop table incident_votes;

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
revoke execute on function submit_community_report(uuid, uuid, text, text, smallint, double precision, double precision, text[], double precision, double precision, integer, double precision, real, real, real) from public, anon, authenticated;
