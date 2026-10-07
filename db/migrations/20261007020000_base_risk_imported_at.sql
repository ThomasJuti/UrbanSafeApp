-- migrate:up
alter table locality_base_risk add column imported_at timestamptz not null default now();

-- migrate:down
alter table locality_base_risk drop column imported_at;
