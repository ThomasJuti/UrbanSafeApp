import { timeBandOf, type RouteOption } from '@urbansafe/shared';
import { generateOrder, SAFE_ROUTE_VALUE, safeRouteVerdict, snapToRoads, type SafeRouteVerdict } from '../features/delivery';
import { createRoutingService, type RouteAlphas } from '../features/routing';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';

// Mide el criterio de la ruta segura con α 20 y 50, directo contra la base, sin cambiar el
// parámetro del producto. pnpm measure:alphas
const ORDERS = 30;
const CONCURRENCY = 2;
const CANDIDATES = [20, 50] as const;

const config = loadConfig();
const { db, pool } = createDb({
  url: config.databaseUrl,
  poolSize: CONCURRENCY,
  statementTimeoutMs: 20_000,
});

function percent(count: number, total: number): string {
  return total === 0 ? '0 %' : `${Math.round((count / total) * 100)} %`;
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);

function pair(options: RouteOption[] | null): { fastest: RouteOption; safest: RouteOption } | null {
  const fastest = options?.find((option) => option.kind === 'fastest');
  const safest = options?.find((option) => option.kind === 'safest');
  return fastest && safest ? { fastest, safest } : null;
}

async function measure(safest: number) {
  const alphas: RouteAlphas = { fastest: 0, balanced: 1, safest };
  const routing = createRoutingService(db, { concurrency: CONCURRENCY, maxQueue: ORDERS, alphas });
  const verdicts: SafeRouteVerdict[] = [];
  let next = 0;
  let failed = 0;

  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= ORDERS) return;
      const generated = await generateOrder(null, (points) => snapToRoads(db, points), Math.random);
      if (!generated) {
        failed += 1;
        continue;
      }
      const now = new Date();
      let first: ReturnType<typeof pair>;
      let second: ReturnType<typeof pair>;
      try {
        first = pair(await routing.planRoutes({ from: generated.start, to: generated.order.pickup }, now));
        second = pair(await routing.planRoutes({ from: generated.order.pickup, to: generated.order.dropoff }, now));
      } catch {
        failed += 1;
        continue;
      }
      if (!first || !second) {
        failed += 1;
        continue;
      }
      verdicts.push(safeRouteVerdict([first, second]));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const meeting = verdicts.filter((verdict) => verdict.meets);
  const reductions = verdicts.flatMap((verdict) => (verdict.exposureReduction === null ? [] : [verdict.exposureReduction]));
  const share = verdicts.length === 0 ? 0 : meeting.length / verdicts.length;
  console.log(
    `α=${safest} (franja ${timeBandOf(new Date())}): ${verdicts.length} pedidos, ${failed} sin ruta · ` +
      `${meeting.length} cumplen (${percent(meeting.length, verdicts.length)}) · ` +
      `exposición evitada media ${Math.round(mean(reductions) * 100)} % · ` +
      `tiempo extra medio ${Math.round(mean(verdicts.map((verdict) => verdict.extraTimeRatio)) * 100)} % · ` +
      (share >= SAFE_ROUTE_VALUE.minOrderShare ? 'cumple' : 'NO cumple'),
  );
  return share >= SAFE_ROUTE_VALUE.minOrderShare;
}

let anyMeets = false;
for (const safest of CANDIDATES) anyMeets = (await measure(safest)) || anyMeets;
console.log(anyMeets ? 'Alguno cumple: se puede subir α de la segura.' : 'Ninguno cumple: α de la segura se queda en 5.');
await pool.end();
