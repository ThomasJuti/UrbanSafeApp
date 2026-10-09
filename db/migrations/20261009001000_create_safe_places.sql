-- migrate:up

-- M6/M8: puntos seguros (CAI/policía y gasolineras 24 h) importados de OSM con
-- pnpm db:import-safe-places. La tabla se reemplaza completa en cada importación.
create table safe_places (
  id bigint generated always as identity primary key,
  osm_type text not null check (osm_type in ('node', 'way')),
  osm_id bigint not null,
  kind text not null check (kind in ('police', 'fuel')),
  name text,
  geom extensions.geometry(Point, 4326) not null,
  unique (osm_type, osm_id)
);
create index safe_places_geom_idx on safe_places using gist (geom);

-- Sin políticas: solo el API, con un rol que no está sujeto a RLS, la lee.
alter table safe_places enable row level security;

-- migrate:down

drop table safe_places;
