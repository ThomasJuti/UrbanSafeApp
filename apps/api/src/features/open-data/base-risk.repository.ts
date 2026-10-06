import { multiPolygonSchema, type BaseRiskResponse } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';
import type { DaiSnapshot } from './dai-source';

const SQUARE_METERS_PER_KM2 = 1_000_000;
// Unos 30 m: suficiente para pintar la localidad sin mandar sus 16 000 vértices al navegador.
const DISPLAY_TOLERANCE_DEG = 0.0003;
const DISPLAY_DECIMALS = 5;

// Se llama dentro de una transacción para no dejar la tabla vacía si algo falla.
export async function replaceBaseRisk(db: Db, snapshot: DaiSnapshot): Promise<void> {
  await db.deleteFrom('locality_base_risk').execute();
  if (snapshot.zones.length === 0) return;

  const values = sql.join(
    snapshot.zones.map(
      (zone) => sql`(${zone.code}, ${zone.name}, ${zone.crimeCount}::integer, ${JSON.stringify(zone.geometry)}::text)`,
    ),
  );

  // M2: delitos/km² normalizados por la localidad con la tasa más alta, para que quede en 0–1.
  await sql`
    with src (code, name, crime_count, geojson) as (values ${values}),
    shaped as (
      select code, name, crime_count,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326)), 3)) as geom
      from src
    ),
    measured as (
      select *, ST_Area(geom::geography) / ${SQUARE_METERS_PER_KM2} as area_km2 from shaped
    ),
    density as (
      select *, crime_count / area_km2 as rate from measured
    )
    insert into locality_base_risk (code, name, crime_count, area_km2, base_risk, period, geom)
    select code, name, crime_count, area_km2, coalesce(rate / nullif(max(rate) over (), 0), 0), ${snapshot.period}, geom
    from density
  `.execute(db);
}

export async function listBaseRisk(db: Db): Promise<BaseRiskResponse> {
  const rows = await db
    .selectFrom('locality_base_risk')
    .select([
      'code',
      'name',
      'base_risk',
      'period',
      sql<string>`ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, ${DISPLAY_TOLERANCE_DEG})), ${DISPLAY_DECIMALS})`.as(
        'geojson',
      ),
    ])
    .orderBy('code')
    .execute();

  return {
    period: rows[0]?.period ?? null,
    zones: rows.map((row) => ({
      code: row.code,
      name: row.name,
      baseRisk: row.base_risk,
      geometry: multiPolygonSchema.parse(JSON.parse(row.geojson)),
    })),
  };
}
