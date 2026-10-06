-- migrate:up
-- M2: RiesgoBaseZona. Se reemplaza completa en cada importación (pnpm db:import-base-risk).
create table locality_base_risk (
  code text primary key,
  name text not null,
  crime_count integer not null check (crime_count >= 0),
  area_km2 double precision not null check (area_km2 > 0),
  base_risk real not null check (base_risk between 0 and 1),
  period text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  updated_at timestamptz not null default now()
);
create index locality_base_risk_geom_idx on locality_base_risk using gist (geom);

alter table locality_base_risk enable row level security;

-- migrate:down
drop table locality_base_risk;
