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

// Al arrancar, y otra vez cada 30 días, si la importación guardada ya cumplió ese plazo.
export function startBaseRiskReview(db: Db, log: (message: string) => void = console.log) {
  let current: Promise<unknown> = Promise.resolve();

  const tick = () => {
    current = (async () => {
      if (!baseRiskIsStale(await latestImportAt(db), Date.now())) return;
      await importBaseRisk(db, log);
    })().catch((error: unknown) => console.error('Falló la revisión del riesgo base', error));
  };

  tick();
  const timer = setInterval(tick, PARAMS.baseRiskReviewMs);
  return async () => {
    clearInterval(timer);
    await current;
  };
}
