-- Incidentes de prueba en Bogotá. Todos usan el prefijo de ID 00000000-0000-4000-8000-
-- para poder borrarlos sin tocar datos reales de la base compartida.
set search_path = public, extensions;

delete from incidents where id::text like '00000000-0000-4000-8000-%';

insert into incidents (id, type, severity, location_kind, geom, occurred_at, time_known, reported_at, confidence) values
  ('00000000-0000-4000-8000-000000000001', 'armed_robbery',    5, 'point', ST_SetSRID(ST_MakePoint(-74.0640, 4.6439), 4326), now() - interval '2 hours',  true,  now() - interval '1 hour',   0.7),
  ('00000000-0000-4000-8000-000000000002', 'motorcycle_theft', 5, 'point', ST_SetSRID(ST_MakePoint(-74.1510, 4.6290), 4326), now() - interval '5 hours',  true,  now() - interval '4 hours',  0.7),
  ('00000000-0000-4000-8000-000000000003', 'personal_theft',   3, 'point', ST_SetSRID(ST_MakePoint(-74.0730, 4.6015), 4326), now() - interval '30 minutes', true, now() - interval '25 minutes', 0.3),
  ('00000000-0000-4000-8000-000000000004', 'fight',            2, 'point', ST_SetSRID(ST_MakePoint(-74.0840, 4.7410), 4326), now() - interval '1 day',    false, now() - interval '20 hours', 0.7),
  ('00000000-0000-4000-8000-000000000005', 'homicide',         5, 'point', ST_SetSRID(ST_MakePoint(-74.1900, 4.6180), 4326), now() - interval '2 days',   true,  now() - interval '2 days',   0.85),
  ('00000000-0000-4000-8000-000000000006', 'bicycle_theft',    5, 'point', ST_SetSRID(ST_MakePoint(-74.0790, 4.6330), 4326), now() - interval '3 hours',  true,  now() - interval '3 hours',  0.45),
  ('00000000-0000-4000-8000-000000000007', 'assault',          4, 'point', ST_SetSRID(ST_MakePoint(-74.1100, 4.7070), 4326), now() - interval '4 days',   true,  now() - interval '4 days',   0.7),
  ('00000000-0000-4000-8000-000000000008', 'personal_theft',   3, 'point', ST_SetSRID(ST_MakePoint(-74.0480, 4.6975), 4326), now() - interval '6 hours',  true,  now() - interval '6 hours',  0.3),
  -- RN-12: confianza bajo el umbral; no debe aparecer en el mapa.
  ('00000000-0000-4000-8000-000000000009', 'armed_robbery',    5, 'point', ST_SetSRID(ST_MakePoint(-74.0660, 4.6480), 4326), now() - interval '1 hour',   true,  now() - interval '1 hour',   0.05);

insert into incident_sources (incident_id, kind, ref) values
  ('00000000-0000-4000-8000-000000000001', 'news',      'https://example.com/seed/atraco-chapinero'),
  ('00000000-0000-4000-8000-000000000002', 'news',      'https://example.com/seed/robo-moto-kennedy'),
  ('00000000-0000-4000-8000-000000000003', 'community', 'seed-device-1'),
  ('00000000-0000-4000-8000-000000000004', 'news',      'https://example.com/seed/rina-suba'),
  ('00000000-0000-4000-8000-000000000005', 'news',      'https://example.com/seed/sicariato-bosa'),
  ('00000000-0000-4000-8000-000000000005', 'news',      'https://example.com/seed/sicariato-bosa-2'),
  ('00000000-0000-4000-8000-000000000006', 'community', 'seed-device-2'),
  ('00000000-0000-4000-8000-000000000007', 'news',      'https://example.com/seed/lesiones-engativa'),
  ('00000000-0000-4000-8000-000000000008', 'community', 'seed-device-3'),
  ('00000000-0000-4000-8000-000000000009', 'community', 'seed-device-4');
