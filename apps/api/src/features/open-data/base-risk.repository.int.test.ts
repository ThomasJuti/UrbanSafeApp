import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import { listBaseRisk, replaceBaseRisk } from './base-risk.repository';
import type { ZoneCount } from './dai-source';

let db: Db;
let close: () => Promise<void>;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  const created = createDb({ url, poolSize: 2, statementTimeoutMs: 10_000 });
  db = created.db;
  close = () => created.pool.end();
});

afterAll(async () => {
  await close?.();
});

// Cuadrados en el mar cerca de (0,0); el de lado doble tiene cuatro veces el área.
function square(code: string, minLng: number, side: number, crimeCount: number): ZoneCount {
  return {
    code,
    name: `Zona ${code}`,
    crimeCount,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minLng, 0],
          [minLng + side, 0],
          [minLng + side, side],
          [minLng, side],
          [minLng, 0],
        ],
      ],
    },
  };
}

describe('replaceBaseRisk (M2)', () => {
  it('normaliza la tasa de delitos/km² por la localidad más alta, no por el conteo', async () => {
    await withRollback(db, async (trx) => {
      await replaceBaseRisk(trx, {
        period: 'Ene-Ago 2026',
        year: 2026,
        zones: [square('A', 0, 0.01, 10), square('B', 0.1, 0.02, 20), square('C', 0.2, 0.01, 0)],
      });

      const { period, zones } = await listBaseRisk(trx);
      const risk = Object.fromEntries(zones.map((zone) => [zone.code, zone.baseRisk]));

      expect(period).toBe('Ene-Ago 2026');
      expect(risk['A']).toBe(1);
      expect(risk['B']).toBeCloseTo(0.5, 2);
      expect(risk['C']).toBe(0);
      expect(zones[0]?.geometry.type).toBe('MultiPolygon');
    });
  });

  it('reemplaza la importación anterior en vez de sumarle', async () => {
    await withRollback(db, async (trx) => {
      await replaceBaseRisk(trx, { period: 'Ene-Jul 2026', year: 2026, zones: [square('A', 0, 0.01, 5)] });
      await replaceBaseRisk(trx, { period: 'Ene-Ago 2026', year: 2026, zones: [square('B', 0.1, 0.01, 5)] });

      const { period, zones } = await listBaseRisk(trx);

      expect(period).toBe('Ene-Ago 2026');
      expect(zones.map((zone) => zone.code)).toEqual(['B']);
    });
  });

  it('deja el riesgo en cero si ninguna localidad tiene delitos', async () => {
    await withRollback(db, async (trx) => {
      await replaceBaseRisk(trx, { period: 'Ene-Ago 2026', year: 2026, zones: [square('A', 0, 0.01, 0)] });

      const { zones } = await listBaseRisk(trx);

      expect(zones[0]?.baseRisk).toBe(0);
    });
  });
});
