import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';
import { importBaseRisk } from './base-risk-import';

export function baseRiskIsStale(importedAt: Date | null, nowMs: number, maxAgeMs = PARAMS.baseRiskReviewMs): boolean {
  if (!importedAt) return true;
  return nowMs - importedAt.getTime() >= maxAgeMs;
}

async function latestImportAt(db: Db): Promise<Date | null> {
  const { rows } = await sql<{ imported_at: Date | null }>`
    select max(imported_at) as imported_at from locality_base_risk
  `.execute(db);
  return rows[0]?.imported_at ?? null;
}

// setInterval guarda el plazo en un entero de 32 bits con signo. 30 días se pasan de ese tope
// (~24,8 días) y Node lo convierte en 1 ms: la consulta pegaba a la base sin parar y el pool se
// quedaba sin conexiones, así que un reporte no terminaba. Se mira una vez al día; la función
// decide si la importación ya cumplió el mes.
export const REVIEW_CHECK_MS = 24 * 60 * 60 * 1000;

// Al arrancar, y otra vez cada día, si la importación guardada ya cumplió 30 días.
export function startBaseRiskReview(db: Db, log: (message: string) => void = console.log) {
  let current: Promise<unknown> = Promise.resolve();

  const tick = () => {
    current = (async () => {
      if (!baseRiskIsStale(await latestImportAt(db), Date.now())) return;
      await importBaseRisk(db, log);
    })().catch((error: unknown) => console.error('Falló la revisión del riesgo base', error));
  };

  tick();
  const timer = setInterval(tick, REVIEW_CHECK_MS);
  return async () => {
    clearInterval(timer);
    await current;
  };
}
