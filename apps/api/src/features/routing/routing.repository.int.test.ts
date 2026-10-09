import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import { queryRoutes } from './routing.repository';

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
const BAND = 2;

async function findPath(trx: Db, from: number | { lng: number; lat: number }, to: number, marginM: number, alpha = 0) {
  const origin = typeof from === 'number' ? point(from) : from;
  const [path] = await queryRoutes(trx, { from: origin, to: point(to), marginM, alphas: [alpha], avoidFactors: [0], band: BAND });
  return path ?? null;
}

async function setRisk(trx: Db, source: number, target: number, risk: number) {
  await trx
    .updateTable('road_edges')
    .set({ risk: [0, 0, risk, 0] })
    .where('source', '=', String(source))
    .where('target', '=', String(target))
    .execute();
}

describe('route_between (M5)', () => {
  it('va directo por el sentido permitido', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const route = await findPath(trx, V.a, V.b, 2000);

      expect(route?.lengthM).toBe(111);
      expect(route?.path).toEqual([AT[V.a], AT[V.b]]);
    });
  });

  it('respeta la contravía y da la vuelta a la manzana, con la línea orientada en el sentido del recorrido', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const route = await findPath(trx, V.b, V.a, 2000);

      expect(route?.lengthM).toBe(333);
      expect(route?.path).toEqual([AT[V.b], AT[V.c], AT[V.d], AT[V.a]]);
    });
  });

  it('el recorte a la caja deja fuera los desvíos lejanos; con un margen mayor sí los encuentra', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);

      expect(await findPath(trx, V.a, V.far, 2000)).toBeNull();
      expect((await findPath(trx, V.a, V.far, 30_000))?.lengthM).toBe(49500);
    });
  });

  it('el origen se ajusta al vértice más cercano', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const nearA = { lng: 5.00005, lat: 4.99995 };

      expect((await findPath(trx, nearA, V.b, 2000))?.path[0]).toEqual(AT[V.a]);
    });
  });
});

describe('route_between con riesgo (RN-07)', () => {
  it('la segura rodea un tramo de riesgo máximo; la balanceada y la rápida no', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await setRisk(trx, V.a, V.b, 1);

      // Directo cuesta 111 × (1 + α); la vuelta por d y c, 333.
      expect((await findPath(trx, V.a, V.b, 2000, 0))?.lengthM).toBe(111);
      expect((await findPath(trx, V.a, V.b, 2000, 1))?.lengthM).toBe(111);
      expect((await findPath(trx, V.a, V.b, 2000, 5))?.path).toEqual([AT[V.a], AT[V.d], AT[V.c], AT[V.b]]);
    });
  });

  it('calcula una ruta por α en una sola consulta, en el mismo orden', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await setRisk(trx, V.a, V.b, 1);

      const paths = await queryRoutes(trx, { from: point(V.a), to: point(V.b), marginM: 2000, alphas: [5, 0], avoidFactors: [0, 0], band: BAND });

      expect(paths.map((path) => path?.lengthM)).toEqual([333, 111]);
    });
  });

  it('usa el riesgo de la franja pedida', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await trx
        .updateTable('road_edges')
        .set({ risk: [1, 0, 0, 0] })
        .where('source', '=', String(V.a))
        .where('target', '=', String(V.b))
        .execute();

      expect((await findPath(trx, V.a, V.b, 2000, 5))?.lengthM).toBe(111);
    });
  });

  it('el riesgo de la ruta es el promedio ponderado por longitud (M5)', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await setRisk(trx, V.b, V.c, 0.9);

      const detour = await findPath(trx, V.b, V.a, 2000);

      // b→c (0,9), c→d (0) y d→a (0), los tres de 111 m.
      expect(detour?.riskScore).toBeCloseTo(0.3, 5);
    });
  });

  it('cuenta los incidentes visibles a menos del radio de influencia de la ruta (M5, RN-12)', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      const incident = (lng: number, lat: number, confidence: number) =>
        trx
          .insertInto('incidents')
          .values({
            type: 'armed_robbery',
            severity: 5,
            location_kind: 'point',
            geom: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
            occurred_at: new Date(),
            time_known: true,
            confidence,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      const near = await incident(5.0005, 5.0001, 0.7);
      const hidden = await incident(5.0005, 5.0001, 0.05);
      const far = await incident(5.0005, 5.01, 0.7);

      const ids = (await findPath(trx, V.a, V.b, 2000))?.nearbyIncidentIds ?? [];

      expect(ids).toContain(near.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(far.id);
    });
  });
});

describe('route_between con zonas a evitar (RN-13)', () => {
  const SEED_ID = '00000000-0000-4000-8000-000000000013';

  // Polígono diminuto sobre el lado a-b: solo ese tramo lo interseca, no la vuelta por d y c.
  async function seedHotIncident(trx: Db, overrides: { severity?: number; confidence?: number; kind?: 'point' | 'neighborhood' | 'locality' } = {}) {
    const kind = overrides.kind ?? 'neighborhood';
    await trx
      .insertInto('incidents')
      .values({
        id: SEED_ID,
        type: 'armed_robbery',
        severity: overrides.severity ?? 5,
        location_kind: kind,
        location_name: kind === 'point' ? null : 'Zona de prueba',
        geom:
          kind === 'point'
            ? sql`ST_SetSRID(ST_MakePoint(5.0005, 5), 4326)`
            : sql`ST_Buffer(ST_SetSRID(ST_MakePoint(5.0005, 5), 4326), 0.00001)`,
        occurred_at: new Date(),
        time_known: true,
        confidence: overrides.confidence ?? 0.7,
      })
      .execute();
  }

  async function plan(trx: Db, avoidFactors: number[]) {
    return queryRoutes(trx, {
      from: point(V.a),
      to: point(V.b),
      marginM: 2000,
      alphas: [0, 0],
      avoidFactors,
      band: BAND,
    });
  }

  it('la ruta con recargo rodea la zona; la rápida pasa y la lista entre sus hotIncidents', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await seedHotIncident(trx);

      const [fastest, safest] = await plan(trx, [0, PARAMS.avoidZone.penalty]);

      expect(fastest?.path).toEqual([AT[V.a], AT[V.b]]);
      expect(fastest?.hotIncidents.map((hot) => hot.id)).toEqual([SEED_ID]);
      expect(safest?.path).toEqual([AT[V.a], AT[V.d], AT[V.c], AT[V.b]]);
      expect(safest?.hotIncidents).toEqual([]);
    });
  });

  it('no es un bloqueo: si no hay otra salida, la ruta con recargo pasa por la zona', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await seedHotIncident(trx, { kind: 'point' });

      // Con el punto en medio del lado, los 150 m cubren también la vuelta: todo cuesta más y el directo gana.
      const [, safest] = await plan(trx, [0, PARAMS.avoidZone.penalty]);

      expect(safest?.path).toEqual([AT[V.a], AT[V.b]]);
      expect(safest?.hotIncidents.map((hot) => hot.id)).toEqual([SEED_ID]);
    });
  });

  it.each([
    ['de severidad baja', { severity: 4 }],
    ['con poca confianza', { confidence: 0.3 }],
    ['de una localidad', { kind: 'locality' as const }],
  ])('un incidente %s no es zona a evitar', async (_, overrides) => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await seedHotIncident(trx, overrides);

      const [fastest, safest] = await plan(trx, [0, PARAMS.avoidZone.penalty]);

      expect(fastest?.hotIncidents).toEqual([]);
      expect(safest?.path).toEqual([AT[V.a], AT[V.b]]);
    });
  });

  it('un incidente fuera de la ventana de alertas no es zona a evitar', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await seedHotIncident(trx);
      await trx.updateTable('incidents').set({ reported_at: new Date(Date.now() - PARAMS.alertWindow.reportedWithinMs - 60_000) }).execute();

      const [fastest] = await plan(trx, [0, 0]);

      expect(fastest?.hotIncidents).toEqual([]);
    });
  });

  it('devuelve los tramos por nivel de riesgo, consecutivos y que cubren toda la ruta', async () => {
    await withRollback(db, async (trx) => {
      await insertGraph(trx);
      await setRisk(trx, V.b, V.c, 0.9);

      const [detour] = await queryRoutes(trx, {
        from: point(V.b),
        to: point(V.a),
        marginM: 2000,
        alphas: [0],
        avoidFactors: [0],
        band: BAND,
      });

      expect(detour?.segments.map((segment) => segment.level)).toEqual(['high', 'low']);
      expect(detour?.segments[0]?.path).toEqual([AT[V.b], AT[V.c]]);
      expect(detour?.segments[1]?.path).toEqual([AT[V.c], AT[V.d], AT[V.a]]);
    });
  });
});
