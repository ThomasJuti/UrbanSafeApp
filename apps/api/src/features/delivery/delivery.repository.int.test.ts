import { haversineM } from '@urbansafe/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { snapToRoads } from './delivery.repository';

// Usa el grafo real de Bogotá: requiere haber corrido `pnpm db:import-graph` en la base de pruebas.
const chapinero = { lat: 4.6486, lng: -74.0628 };
const ocean = { lat: -30, lng: -30 };
// Centro de Soacha: tiene calles en el grafo, pero no es Bogotá.
const soacha = { lat: 4.5793, lng: -74.2168 };
const MAX_SNAP_M = 200;

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 1, statementTimeoutMs: 15_000 }).db;
});

afterAll(async () => {
  await db?.destroy();
});

describe('snapToRoads (M7)', () => {
  it('lleva cada punto al vértice más cercano y descarta los que no tienen calle cerca, en orden', async () => {
    const [snapped, none] = await snapToRoads(db, [chapinero, ocean]);

    expect(snapped).not.toBeNull();
    expect(haversineM([chapinero.lng, chapinero.lat], [snapped!.lng, snapped!.lat])).toBeLessThan(MAX_SNAP_M);
    expect(none).toBeNull();
  });

  it('descarta los puntos con calle que caen fuera de las localidades de Bogotá', async () => {
    const [snapped, outside] = await snapToRoads(db, [chapinero, soacha]);

    expect(snapped).not.toBeNull();
    expect(outside).toBeNull();
  });
});
