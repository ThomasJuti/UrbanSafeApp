import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import { listVisibleInBbox } from './incidents.repository';

// Caja en el océano frente a la Isla Nula, lejos de cualquier dato real o de seed.
const BBOX = { minLng: 0, minLat: 0, maxLng: 0.01, maxLat: 0.01 };

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

function insertPoint(trx: Db, values: { lng: number; lat: number; confidence: number }) {
  return trx
    .insertInto('incidents')
    .values({
      type: 'armed_robbery',
      severity: 5,
      location_kind: 'point',
      geom: sql`ST_SetSRID(ST_MakePoint(${values.lng}, ${values.lat}), 4326)`,
      occurred_at: new Date(),
      time_known: true,
      confidence: values.confidence,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

describe('listVisibleInBbox', () => {
  it('devuelve solo incidentes visibles dentro de la caja (RN-12)', async () => {
    await withRollback(db, async (trx) => {
      const inside = await insertPoint(trx, { lng: 0.005, lat: 0.005, confidence: 0.7 });
      const hidden = await insertPoint(trx, { lng: 0.005, lat: 0.006, confidence: 0.05 });
      const atThreshold = await insertPoint(trx, { lng: 0.004, lat: 0.004, confidence: 0.1 });
      const outside = await insertPoint(trx, { lng: 0.5, lat: 0.5, confidence: 0.7 });

      const ids = (await listVisibleInBbox(trx, BBOX, 100)).map((i) => i.id);

      expect(ids).toContain(inside.id);
      expect(ids).toContain(atThreshold.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(outside.id);
    });
  });

  it('dibuja las áreas con un punto dentro del polígono', async () => {
    await withRollback(db, async (trx) => {
      const { id } = await trx
        .insertInto('incidents')
        .values({
          type: 'personal_theft',
          severity: 3,
          location_kind: 'neighborhood',
          location_name: 'Barrio de prueba',
          geom: sql`ST_MakeEnvelope(0.002, 0.002, 0.008, 0.008, 4326)`,
          occurred_at: new Date(),
          time_known: false,
          confidence: 0.35,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const incident = (await listVisibleInBbox(trx, BBOX, 100)).find((i) => i.id === id);

      expect(incident?.location).toMatchObject({ kind: 'area', level: 'neighborhood', name: 'Barrio de prueba' });
      expect(incident?.location.point.lat).toBeGreaterThan(0.002);
      expect(incident?.location.point.lat).toBeLessThan(0.008);
    });
  });
});
