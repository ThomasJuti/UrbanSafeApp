-- migrate:up
create table reporters (
  device_id uuid primary key,
  nickname text not null check (char_length(nickname) between 2 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table community_reports (
  id bigint generated always as identity primary key,
  client_id uuid not null unique,
  device_id uuid not null references reporters (device_id),
  incident_id uuid not null references incidents (id) on delete cascade,
  outcome text not null check (outcome in ('created', 'confirmed', 'already_counted')),
  created_at timestamptz not null default now()
);

-- RN-04: el límite por hora cuenta los envíos recientes de cada dispositivo.
create index community_reports_device_created_idx on community_reports (device_id, created_at);
create index community_reports_incident_idx on community_reports (incident_id);

-- RN-09 busca el mismo hecho a 500 m con ST_DWithin sobre geography; sin esto no usa índice.
create index incidents_geog_idx on incidents using gist ((geom::extensions.geography));

alter table reporters enable row level security;
alter table community_reports enable row level security;

-- migrate:down
drop index incidents_geog_idx;
drop table community_reports;
drop table reporters;
