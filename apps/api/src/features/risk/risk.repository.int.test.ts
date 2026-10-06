import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import { refreshEdgeRisk, refreshTimeMultipliers } from './risk.repository';

// Tramos de juguete en el mar cerca de (6,6), lejos de Bogotá y de las otras pruebas. Ids altos
// para no chocar con nodos de OSM.
const NODE = 8e15;
const DAY_MS = 24 * 60 * 60 * 1000;
const ON_EDGE = { lng: 6.001, lat: 6 };
// 0,0009° de latitud son ~100 m.
const NORTH_OFFSET_DEG = 0.0009;
const NORTH_DISTANCE_M = 99.5;

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 4, statementTimeoutMs: 15_000 }).db;
});

afterAll(async () => {
  await db?.destroy();
});

async function insertEdge(trx: Db, n: number, [x1, y1]: [number, number], [x2, y2]: [number, number]) {
  const { id } = await trx
    .insertInto('road_edges')
    .values({
      osm_way_id: '1',
      source: String(NODE + n * 2),
      target: String(NODE + n * 2 + 1),
      highway: 'residential',
      name: null,
      length_m: 222,
      cost_s: 32,
      reverse_cost_s: 32,
      geom: sql`ST_MakeLine(ST_SetSRID(ST_MakePoint(${x1}, ${y1}), 4326), ST_SetSRID(ST_MakePoint(${x2}, ${y2}), 4326))`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

function insertToyEdges(trx: Db) {
  return Promise.all([
    insertEdge(trx, 1, [6, 6], [6.002, 6]),
    insertEdge(trx, 2, [6, 6 + NORTH_OFFSET_DEG], [6.002, 6 + NORTH_OFFSET_DEG]),
    insertEdge(trx, 3, [6, 6.05], [6.002, 6.05]),
  ]);
}

type IncidentInput = {
  geom: ReturnType<typeof sql>;
  kind?: 'point' | 'neighborhood';
  severity?: number;
  confidence?: number;
  occurredAt?: Date;
};

async function insertIncident(trx: Db, input: IncidentInput) {
  const { id } = await trx
    .insertInto('incidents')
    .values({
      type: 'armed_robbery',
      severity: input.severity ?? 5,
      location_kind: input.kind ?? 'point',
      location_name: input.kind === 'neighborhood' ? 'Barrio de prueba' : null,
      geom: input.geom,
      occurred_at: input.occurredAt ?? new Date(),
      time_known: true,
      confidence: input.confidence ?? 0.7,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

const at = ({ lng, lat }: { lng: number; lat: number }) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

async function edgeRisk(trx: Db, id: string) {
  return trx
    .selectFrom('road_edges')
    .select(['recent_risk', 'risk'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

const recentFrom = (total: number) => 1 - Math.exp(-total / PARAMS.saturationK);

describe('refresh_edge_risk (RN-06, RN-10)', () => {
  it('un incidente puntual pesa completo sobre su tramo y cae linealmente hasta el radio', async () => {
    await withRollback(db, async (trx) => {
      const [onEdge, north, far] = await insertToyEdges(trx);
      const id = await insertIncident(trx, { geom: at(ON_EDGE) });

      await refreshEdgeRisk(trx, [id]);

      // Atraco con arma de noticias: peso 5 × 0,7 = 3,5.
      const weight = 5 * 0.7;
      const onEdgeRisk = await edgeRisk(trx, onEdge);
      expect(onEdgeRisk.recent_risk).toBeCloseTo(recentFrom(weight), 3);
      expect((await edgeRisk(trx, north)).recent_risk).toBeCloseTo(
        recentFrom(weight * (1 - NORTH_DISTANCE_M / PARAMS.influenceRadiusM)),
        2,
      );
      expect((await edgeRisk(trx, far)).recent_risk).toBe(0);
      // Sin localidad: riesgo base 0 y multiplicador 1 en todas las franjas.
      for (const value of onEdgeRisk.risk) {
        expect(value).toBeCloseTo(PARAMS.weights.recent * onEdgeRisk.recent_risk, 5);
      }
    });
  });

  it('un incidente de hace τ pesa ~37 % de uno de hoy (RN-06)', async () => {
    await withRollback(db, async (trx) => {
      const [onEdge] = await insertToyEdges(trx);
      const id = await insertIncident(trx, {
        geom: at(ON_EDGE),
        occurredAt: new Date(Date.now() - PARAMS.decayTauMs),
      });

      await refreshEdgeRisk(trx, [id]);

      expect((await edgeRisk(trx, onEdge!)).recent_risk).toBeCloseTo(recentFrom(5 * 0.7 * Math.exp(-1)), 3);
    });
  });

  it('un incidente de área reparte su peso según el tamaño de la zona', async () => {
    await withRollback(db, async (trx) => {
      const [onEdge] = await insertToyEdges(trx);
      const area = sql`ST_MakeEnvelope(5.996, 5.996, 6.004, 6.004, 4326)`;
      const id = await insertIncident(trx, { geom: area, kind: 'neighborhood', severity: 3, confidence: 0.35 });
      const { rows } = await sql<{ m2: number }>`select ST_Area(${area}::geography) as m2`.execute(trx);
      const factor = Math.min(1, (Math.PI * PARAMS.influenceRadiusM ** 2) / rows[0]!.m2);

      await refreshEdgeRisk(trx, [id]);

      expect(factor).toBeLessThan(1);
      expect((await edgeRisk(trx, onEdge!)).recent_risk).toBeCloseTo(recentFrom(3 * 0.35 * factor), 3);
    });
  });

  it('cuando las negaciones ocultan un incidente, su tramo vuelve a cero (RN-12)', async () => {
    await withRollback(db, async (trx) => {
      const [onEdge] = await insertToyEdges(trx);
      const id = await insertIncident(trx, { geom: at(ON_EDGE) });
      await refreshEdgeRisk(trx, [id]);

      await trx.updateTable('incidents').set({ confidence: 0.05 }).where('id', '=', id).execute();
      await refreshEdgeRisk(trx, [id]);

      const risk = await edgeRisk(trx, onEdge!);
      expect(risk.recent_risk).toBe(0);
      expect(risk.risk).toEqual([0, 0, 0, 0]);
    });
  });
});

describe('refresh_time_multipliers (RN-11)', () => {
  it('reparte por franja, acota a [0,5; 2] y combina con el riesgo base (RN-10)', async () => {
    await withRollback(db, async (trx) => {
      const [onEdge] = await insertToyEdges(trx);
      const zone = sql`ST_Multi(ST_MakeEnvelope(7, 7, 7.01, 7.01, 4326))`;
      await trx
        .insertInto('locality_base_risk')
        .values({ code: 'T1', name: 'Prueba', crime_count: 1, area_km2: 1, base_risk: 0.5, period: 'prueba', geom: zone })
        .execute();
      await trx.updateTable('road_edges').set({ locality_code: 'T1' }).where('id', '=', onEdge!).execute();

      // 8 de noche (20:00 en Bogotá = 01:00 UTC) y 2 de mañana (08:00 = 13:00 UTC).
      const day = new Date(Date.now() - 3 * DAY_MS);
      const atUtcHour = (hour: number) =>
        new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour));
      const inZone = at({ lng: 7.005, lat: 7.005 });
      for (let i = 0; i < 8; i++) await insertIncident(trx, { geom: inZone, occurredAt: atUtcHour(1) });
      for (let i = 0; i < 2; i++) await insertIncident(trx, { geom: inZone, occurredAt: atUtcHour(13) });
      // Oculto y sobre el tramo: solo sirve para que el recálculo lo incluya.
      const trigger = await insertIncident(trx, { geom: at(ON_EDGE), confidence: 0.05 });

      await refreshTimeMultipliers(trx);
      await refreshEdgeRisk(trx, [trigger]);

      const multipliers = await trx
        .selectFrom('locality_time_multipliers')
        .select(['band', 'multiplier'])
        .where('locality_code', '=', 'T1')
        .orderBy('band')
        .execute();
      // m = 4 × fracción: noche 3,2 → 2; mañana 0,8; madrugada y tarde 0 → 0,5.
      expect(multipliers.map((row) => row.multiplier)).toEqual([0.5, 0.8, 0.5, 2].map((m) => expect.closeTo(m, 5)));

      const base = PARAMS.weights.base * 0.5;
      expect((await edgeRisk(trx, onEdge!)).risk).toEqual([0.5, 0.8, 0.5, 2].map((m) => expect.closeTo(base * m, 5)));
    });
  });
});

describe('recálculos simultáneos', () => {
  it('se encolan con el advisory lock en vez de bloquearse entre sí', async () => {
    const recent = await db
      .selectFrom('incidents')
      .select('id')
      .orderBy('reported_at', 'desc')
      .limit(5)
      .execute();
    const ids = recent.map((row) => row.id);

    const results = await Promise.all([refreshEdgeRisk(db, ids), refreshEdgeRisk(db, ids), refreshEdgeRisk(db, ids)]);

    expect(results).toHaveLength(3);
  });
});
