import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

// Recalcular toda la ciudad toma unos segundos; el límite general del pool es más corto.
const FULL_REFRESH_TIMEOUT_MS = 120_000;
const MS_PER_SECOND = 1000;

async function withTimeout<T>(db: Db, timeoutMs: number, fn: (trx: Db) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('statement_timeout', ${String(timeoutMs)}, true)`.execute(trx);
    return fn(trx);
  });
}

// Null recalcula toda la ciudad; una lista, solo los tramos cerca de esos incidentes.
export async function refreshEdgeRisk(db: Db, incidentIds: string[] | null): Promise<number> {
  const run = async (trx: Db) => {
    const { rows } = await sql<{ updated: number }>`
      select refresh_edge_risk(
        ${incidentIds}::uuid[],
        ${PARAMS.influenceRadiusM},
        ${PARAMS.decayTauMs / MS_PER_SECOND},
        ${PARAMS.mapWindowMs / MS_PER_SECOND},
        ${PARAMS.saturationK},
        ${PARAMS.weights.base},
        ${PARAMS.weights.recent},
        ${PARAMS.hourlyMultiplier.bandHours}::integer,
        ${PARAMS.visibilityThreshold}::real
      ) as updated
    `.execute(trx);
    return rows[0]?.updated ?? 0;
  };
  return incidentIds ? run(db) : withTimeout(db, FULL_REFRESH_TIMEOUT_MS, run);
}

export async function refreshTimeMultipliers(db: Db): Promise<void> {
  const { windowMs, minIncidentsWithTime, min, max, bandHours } = PARAMS.hourlyMultiplier;
  await sql`
    select refresh_time_multipliers(
      ${windowMs / MS_PER_SECOND},
      ${minIncidentsWithTime}::integer,
      ${min},
      ${max},
      ${bandHours}::integer,
      ${PARAMS.timeZone},
      ${PARAMS.visibilityThreshold}::real
    )
  `.execute(db);
}

// Reescribir el riesgo de toda la ciudad duplica el tamaño de road_edges y deja de caber en la
// memoria de la base: el ruteo pasa de ~0,3 s a ~3 s. Bloquea la tabla mientras corre, así que
// solo va después de importar.
export async function compactRoadEdges(db: Db): Promise<void> {
  await sql`vacuum (full, analyze) road_edges`.execute(db);
}

export async function assignEdgeLocalities(db: Db): Promise<number> {
  return withTimeout(db, FULL_REFRESH_TIMEOUT_MS, async (trx) => {
    const { rows } = await sql<{ updated: number }>`select assign_edge_localities() as updated`.execute(trx);
    return rows[0]?.updated ?? 0;
  });
}
