import { PARAMS } from '@urbansafe/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { haversineM } from './osm-graph';
import { createRoutingService } from './routing.service';

// Usa el grafo real de Bogotá: requiere haber corrido `pnpm db:import-graph` en la base de pruebas.
const chapinero = { lat: 4.6486, lng: -74.0628 };
const kennedy = { lat: 4.6283, lng: -74.1527 };
const MAX_SNAP_M = 300;

let db: Db;

beforeAll(async () => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 4, statementTimeoutMs: 15_000 }).db;
  const { count } = await db
    .selectFrom('road_edges')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  if (Number(count) === 0) throw new Error('No hay grafo de calles: corre `pnpm db:import-graph` primero');
});

afterAll(async () => {
  await db?.destroy();
});

describe('planRoutes sobre el grafo de Bogotá (M5)', () => {
  it('la ruta más rápida va de punta a punta, con el tiempo a la velocidad promedio', async () => {
    const service = createRoutingService(db, 2);

    const routes = await service.planRoutes({ from: chapinero, to: kennedy });
    const fastest = routes?.[0];

    expect(fastest?.kind).toBe('fastest');
    expect(haversineM(fastest!.path[0]!, [chapinero.lng, chapinero.lat])).toBeLessThan(MAX_SNAP_M);
    expect(haversineM(fastest!.path.at(-1)!, [kennedy.lng, kennedy.lat])).toBeLessThan(MAX_SNAP_M);
    // La ruta por calles es más larga que la línea recta, pero no absurda.
    const straight = haversineM([chapinero.lng, chapinero.lat], [kennedy.lng, kennedy.lat]);
    expect(fastest!.lengthM).toBeGreaterThan(straight);
    expect(fastest!.lengthM).toBeLessThan(straight * 2);
    expect(fastest!.durationS).toBeCloseTo(fastest!.lengthM / ((PARAMS.motorcycleSpeedKmh * 1000) / 3600));
  });

  it('devuelve rápida, balanceada y segura; la segura nunca es más riesgosa ni la rápida más lenta (RN-07)', async () => {
    const service = createRoutingService(db, 3);

    const routes = (await service.planRoutes({ from: chapinero, to: kennedy }))!;
    const [fastest, balanced, safest] = routes;

    expect(routes.map((option) => option.kind)).toEqual(['fastest', 'balanced', 'safest']);
    expect(fastest!.durationS).toBeLessThanOrEqual(balanced!.durationS);
    expect(fastest!.durationS).toBeLessThanOrEqual(safest!.durationS);
    expect(safest!.riskScore).toBeLessThanOrEqual(fastest!.riskScore);
  });

  it('con más pedidos que el límite de concurrencia, los que sobran esperan y todos terminan', async () => {
    const service = createRoutingService(db, 2);

    const results = await Promise.all(Array.from({ length: 3 }, () => service.planRoutes({ from: chapinero, to: kennedy })));

    expect(results.every((routes) => routes?.length === 3)).toBe(true);
  });
});
