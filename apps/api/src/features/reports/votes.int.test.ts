import { randomUUID } from 'node:crypto';
import {
  PARAMS,
  type CastVoteBody,
  type CreateReportBody,
  type DomainEventName,
  type LatLng,
  type Vote,
} from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { castVote, submitReport } from './reports.service';

// Igual que en reports.service.int.test.ts, esto hace commit. Usa otra franja del mar (lng 1,3)
// para que la limpieza de un archivo no borre datos del otro mientras corren en paralelo.
const AREA = { minLng: 1.2, minLat: 0.9, maxLng: 1.4, maxLat: 3 };
const devices: string[] = [];
const { confirm, deny } = PARAMS.confidenceAdjustments;
const base = PARAMS.initialConfidence.community;

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 6, statementTimeoutMs: 15_000 }).db;
});

afterAll(async () => {
  if (!db) return;
  await db
    .deleteFrom('incidents')
    .where(sql<boolean>`geom && ST_MakeEnvelope(${AREA.minLng}, ${AREA.minLat}, ${AREA.maxLng}, ${AREA.maxLat}, 4326)`)
    .execute();
  if (devices.length) await db.deleteFrom('reporters').where('device_id', 'in', devices).execute();
  await db.destroy();
});

let nextSpot = 0;
function spot(): LatLng {
  nextSpot += 1;
  return { lat: 1 + nextSpot * 0.05, lng: 1.3 };
}

function newDevice(): string {
  const id = randomUUID();
  devices.push(id);
  return id;
}

function recordingBus() {
  const events: { name: DomainEventName; incidentId: string; confidence: number }[] = [];
  const bus: EventBus = {
    publish: (name, payload) => {
      if ('incident' in payload) {
        events.push({ name, incidentId: payload.incident.id, confidence: payload.incident.confidence });
      }
    },
    subscribe: () => () => {},
  };
  return { bus, events };
}

const { bus: silentBus } = recordingBus();

async function reportAt(point: LatLng, deviceId = newDevice()) {
  const body: CreateReportBody = { clientId: randomUUID(), deviceId, nickname: 'tester', type: 'fight', point };
  const result = await submitReport(db, silentBus, body);
  if (result.kind !== 'accepted') throw new Error(`Se esperaba aceptado y llegó ${result.kind}`);
  return result;
}

function vote(incidentId: string, value: Vote, deviceId = newDevice()): CastVoteBody {
  return { incidentId, deviceId, nickname: 'votante', vote: value };
}

async function confidenceOf(id: string) {
  const row = await db.selectFrom('incidents').select('confidence').where('id', '=', id).executeTakeFirstOrThrow();
  return row.confidence;
}

async function balanceOf(deviceId: string) {
  const row = await db
    .selectFrom('reporters')
    .select('vote_balance')
    .where('device_id', '=', deviceId)
    .executeTakeFirstOrThrow();
  return row.vote_balance;
}

describe('castVote', () => {
  it('confirmar sube la confianza y lo publica; repetir el voto no cuenta otra vez', async () => {
    const { bus, events } = recordingBus();
    const { incident } = await reportAt(spot());
    const body = vote(incident.id, 'confirm');

    expect(await castVote(db, bus, body)).toEqual({ kind: 'accepted', outcome: 'counted' });
    expect(await castVote(db, bus, body)).toEqual({ kind: 'accepted', outcome: 'counted' });

    expect(await confidenceOf(incident.id)).toBeCloseTo(base + confirm);
    expect(events).toEqual([{ name: 'incident.updated', incidentId: incident.id, confidence: expect.closeTo(base + confirm) }]);
  });

  it('cada usuario vota una sola vez: no puede cambiar de confirmar a negar (RN-04)', async () => {
    const { bus } = recordingBus();
    const { incident } = await reportAt(spot());
    const device = newDevice();

    await castVote(db, bus, vote(incident.id, 'confirm', device));
    const second = await castVote(db, bus, vote(incident.id, 'deny', device));

    expect(second).toEqual({ kind: 'accepted', outcome: 'already_voted' });
    expect(await confidenceOf(incident.id)).toBeCloseTo(base + confirm);
  });

  it('nadie vota sobre su propio reporte (RN-04)', async () => {
    const { bus, events } = recordingBus();
    const author = newDevice();
    const { incident } = await reportAt(spot(), author);

    expect(await castVote(db, bus, vote(incident.id, 'confirm', author))).toEqual({
      kind: 'accepted',
      outcome: 'own_report',
    });
    expect(await confidenceOf(incident.id)).toBeCloseTo(base);
    expect(events).toHaveLength(0);
  });

  it('dos negaciones ocultan un reporte nuevo y una confirmación por reporte lo vuelve a mostrar (RN-12)', async () => {
    const { bus, events } = recordingBus();
    const point = spot();
    const { incident } = await reportAt(point);

    await castVote(db, bus, vote(incident.id, 'deny'));
    expect(await confidenceOf(incident.id)).toBeGreaterThanOrEqual(PARAMS.visibilityThreshold - 1e-6);
    await castVote(db, bus, vote(incident.id, 'deny'));

    expect(events.at(-1)?.confidence).toBeLessThan(PARAMS.visibilityThreshold);
    expect(await castVote(db, bus, vote(incident.id, 'confirm'))).toEqual({ kind: 'not_available' });

    const comeback = await reportAt(point);
    expect(comeback.outcome).toBe('confirmed');
    expect(comeback.incident.id).toBe(incident.id);
    expect(comeback.incident.confidence).toBeGreaterThanOrEqual(PARAMS.visibilityThreshold);
  });

  it('la confianza nunca baja de 0', async () => {
    const { bus } = recordingBus();
    const { incident } = await reportAt(spot());
    await db.updateTable('incidents').set({ confidence: 0.15 }).where('id', '=', incident.id).execute();

    await castVote(db, bus, vote(incident.id, 'deny'));

    expect(await confidenceOf(incident.id)).toBe(0);
  });

  it('quien ya votó un incidente no lo confirma otra vez reportándolo (RN-09)', async () => {
    const { bus } = recordingBus();
    const point = spot();
    const { incident } = await reportAt(point);
    const voter = newDevice();
    await castVote(db, bus, vote(incident.id, 'confirm', voter));

    const report = await reportAt(point, voter);

    expect(report.outcome).toBe('already_counted');
    expect(await confidenceOf(incident.id)).toBeCloseTo(base + confirm);
  });
});

describe('reputación (RN-04)', () => {
  it('las confirmaciones de otros, por voto o por reporte, suben la confianza inicial de los próximos reportes', async () => {
    const { bus } = recordingBus();
    const author = newDevice();
    const point = spot();
    const { incident } = await reportAt(point, author);

    await castVote(db, bus, vote(incident.id, 'confirm'));
    await castVote(db, bus, vote(incident.id, 'confirm'));
    await reportAt(point);

    expect(await balanceOf(author)).toBe(3);
    const next = await reportAt(spot(), author);
    expect(next.incident.confidence).toBeCloseTo(base + 3 * PARAMS.reputation.stepPerBalance);
  });

  it('con saldo negativo la confianza inicial no baja de la base', async () => {
    const { bus } = recordingBus();
    const author = newDevice();
    const { incident } = await reportAt(spot(), author);

    await castVote(db, bus, vote(incident.id, 'deny'));

    expect(await balanceOf(author)).toBe(-1);
    expect((await reportAt(spot(), author)).incident.confidence).toBeCloseTo(base);
  });

  it(`la confianza inicial se queda en ${PARAMS.reputation.maxInitialConfidence} por mucho saldo que haya`, async () => {
    const author = newDevice();
    await reportAt(spot(), author);
    await db.updateTable('reporters').set({ vote_balance: 1000 }).where('device_id', '=', author).execute();

    expect((await reportAt(spot(), author)).incident.confidence).toBeCloseTo(PARAMS.reputation.maxInitialConfidence);
  });
});

describe('castVote con envíos simultáneos', () => {
  it('el mismo voto enviado 5 veces a la vez cuenta una sola vez', async () => {
    const { bus, events } = recordingBus();
    const { incident } = await reportAt(spot());
    const body = vote(incident.id, 'confirm');

    const results = await Promise.all(Array.from({ length: 5 }, () => castVote(db, bus, body)));

    expect(results.every((r) => r.kind === 'accepted' && r.outcome === 'counted')).toBe(true);
    expect(events).toHaveLength(1);
    expect(await confidenceOf(incident.id)).toBeCloseTo(base + confirm);
  });

  it('confirmar y negar a la vez desde el mismo dispositivo deja un solo voto', async () => {
    const { bus } = recordingBus();
    const { incident } = await reportAt(spot());
    const device = newDevice();

    const results = await Promise.all([
      castVote(db, bus, vote(incident.id, 'confirm', device)),
      castVote(db, bus, vote(incident.id, 'deny', device)),
    ]);

    const outcomes = results.map((r) => (r.kind === 'accepted' ? r.outcome : r.kind)).sort();
    expect(outcomes).toEqual(['already_voted', 'counted']);
    const final = await confidenceOf(incident.id);
    expect([base + confirm, base + deny].some((c) => Math.abs(c - final) < 1e-6)).toBe(true);
    const votes = await db.selectFrom('incident_votes').select('vote').where('incident_id', '=', incident.id).execute();
    expect(votes).toHaveLength(1);
  });

  it('cuatro personas confirmando a la vez suman las cuatro confirmaciones', async () => {
    const { bus } = recordingBus();
    const author = newDevice();
    const { incident } = await reportAt(spot(), author);

    await Promise.all(Array.from({ length: 4 }, () => castVote(db, bus, vote(incident.id, 'confirm'))));

    expect(await confidenceOf(incident.id)).toBeCloseTo(base + 4 * confirm);
    expect(await balanceOf(author)).toBe(4);
  });
});
