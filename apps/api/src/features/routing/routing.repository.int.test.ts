import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import { queryRoute } from './routing.repository';

// Grafo de juguete en el mar cerca de (5,5), lejos de Bogotá: el vértice más cercano a estos
// puntos siempre es uno de prueba. Ids altos para no chocar con nodos de OSM.
const V = { a: 9e15 + 1, b: 9e15 + 2, c: 9e15 + 3, d: 9e15 + 4, far: 9e15 + 5, north1: 9e15 + 6, north2: 9e15 + 7 };
const AT: Record<number, [number, number]> = {
  [V.a]: [5, 5],
  [V.b]: [5.001, 5],
  [V.c]: [5.001, 5.001],
  [V.d]: [5, 5.001],
  [V.far]: [5.05, 5],
  [V.north1]: [5, 5.2],
  [V.north2]: [5.05, 5.2],
};
const ONE_WAY = -1;

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 2, statementTimeoutMs: 10_000 }).db;
});

afterAll(async () => {
  await db?.destroy();
});

async function insertGraph(trx: Db) {
  await trx
    .insertInto('road_vertices')
    .values(
      Object.entries(AT).map(([id, [lng, lat]]) => ({
        id: String(id),
        geom: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
      })),
    )
    .execute();

  const edge = (source: number, target: number, cost: number, reverse: number) => {
    const [x1, y1] = AT[source]!;
    const [x2, y2] = AT[target]!;
    return {
      osm_way_id: '1',
      source: String(source),
      target: String(target),
      highway: 'residential',
      name: null,
      length_m: cost,
      cost_s: cost,
      reverse_cost_s: reverse,
      geom: sql`ST_MakeLine(ST_SetSRID(ST_MakePoint(${x1}, ${y1}), 4326), ST_SetSRID(ST_MakePoint(${x2}, ${y2}), 4326))`,
    };
  };

  // Cuadrado a-b-c-d. a→b es de un solo sentido; los otros lados van en los dos.
  // El único camino a "far" sube 22 km al norte; el tramo north1-north2 queda entero fuera de
  // la caja chica, los otros dos la tocan por un extremo.
  await trx
    .insertInto('road_edges')
    .values([
      edge(V.a, V.b, 111, ONE_WAY),
      edge(V.b, V.c, 111, 111),
      edge(V.c, V.d, 111, 111),
      edge(V.d, V.a, 111, 111),
      edge(V.a, V.north1, 22000, 22000),
      edge(V.north1, V.north2, 5500, 5500),
      edge(V.north2, V.far, 22000, 22000),
    ])
    .execute();
}

const point = (id: number) => ({ lng: AT[id]![0], lat: AT[id]![1] });

describe('route_between (M5)', () => {
  it('va directo por el sentido permitido', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const route = await queryRoute(trx, point(V.a), point(V.b), 2000);

      expect(route?.lengthM).toBe(111);
      expect(route?.path).toEqual([AT[V.a], AT[V.b]]);
    });
  });

  it('respeta la contravía y da la vuelta a la manzana, con la línea orientada en el sentido del recorrido', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const route = await queryRoute(trx, point(V.b), point(V.a), 2000);

      expect(route?.lengthM).toBe(333);
      expect(route?.path).toEqual([AT[V.b], AT[V.c], AT[V.d], AT[V.a]]);
    });
  });

  it('el recorte a la caja deja fuera los desvíos lejanos; con un margen mayor sí los encuentra', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);

      expect(await queryRoute(trx, point(V.a), point(V.far), 2000)).toBeNull();
      expect((await queryRoute(trx, point(V.a), point(V.far), 30_000))?.lengthM).toBe(49500);
    });
  });

  it('el origen se ajusta al vértice más cercano', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const nearA = { lng: 5.00005, lat: 4.99995 };

      expect((await queryRoute(trx, nearA, point(V.b), 2000))?.path[0]).toEqual(AT[V.a]);
    });
  });
});
