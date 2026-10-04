-- migrate:up
create extension if not exists postgis with schema extensions;

set local search_path = public, extensions;

-- Incidente (spec, sección 4; RN-01). Las ubicaciones de área guardan el polígono del barrio o localidad.
create table incidents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'personal_theft', 'motorcycle_theft', 'bicycle_theft', 'vehicle_theft',
    'armed_robbery', 'homicide', 'assault', 'fight', 'other'
  )),
  severity smallint not null check (severity between 1 and 5),
  location_kind text not null check (location_kind in ('point', 'neighborhood', 'locality')),
  location_name text,
  geom geometry(Geometry, 4326) not null,
  occurred_at timestamptz not null,
  time_known boolean not null,
  reported_at timestamptz not null default now(),
  confidence real not null check (confidence between 0 and 1),
  constraint incidents_location_shape check (
    (location_kind = 'point' and ST_GeometryType(geom) = 'ST_Point')
    or (
      location_kind in ('neighborhood', 'locality')
      and ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon')
      and location_name is not null
    )
  )
);

create index incidents_geom_idx on incidents using gist (geom);
create index incidents_occurred_at_idx on incidents (occurred_at);

create table incident_sources (
  id bigint generated always as identity primary key,
  incident_id uuid not null references incidents (id) on delete cascade,
  kind text not null check (kind in ('news', 'community')),
  ref text not null,
  added_at timestamptz not null default now(),
  unique (incident_id, kind, ref)
);

-- RN-09: búsqueda de duplicados exactos por URL antes de llamar al LLM.
create index incident_sources_kind_ref_idx on incident_sources (kind, ref);

-- Supabase expone `public` por su API REST; sin políticas, solo el API (rol sin RLS) accede.
alter table incidents enable row level security;
alter table incident_sources enable row level security;

-- migrate:down
drop table incident_sources;
drop table incidents;
