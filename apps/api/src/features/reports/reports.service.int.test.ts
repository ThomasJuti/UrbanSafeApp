import { randomUUID } from 'node:crypto';
import { PARAMS, type CreateReportBody, type DomainEventName, type LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { submitReport } from './reports.service';

// Estas pruebas hacen commit (el servicio abre su propia transacción). Todo lo que crean cae
// en el mar cerca de (1,1) o usa dispositivos de esta corrida, y se borra en afterAll.
const AREA = { minLng: 0.9, minLat: 0.9, maxLng: 1.1, maxLat: 3 };
const devices: string[] = [];

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
// Cada prueba usa su propio punto, a ~5,5 km del anterior, para que no se fusionen entre sí.
function spot(): LatLng {
  nextSpot += 1;
  return { lat: 1 + nextSpot * 0.05, lng: 1 };
}

function offsetMeters(point: LatLng, northM: number): LatLng {
  return { lat: point.lat + northM / 111_320, lng: point.lng };
}

function newDevice(): string {
  const id = randomUUID();
  devices.push(id);
  return id;
}

function report(overrides: Partial<CreateReportBody> & Pick<CreateReportBody, 'deviceId' | 'point'>): CreateReportBody {
  return { clientId: randomUUID(), nickname: 'tester', type: 'armed_robbery', ...overrides };
}

function recordingBus() {
  const events: { name: DomainEventName; incidentId: string }[] = [];
  const bus: EventBus = {
    publish: (name, payload) => events.push({ name, incidentId: payload.incident.id }),
    subscribe: () => () => {},
  };
  return { bus, events };
}

async function accepted(promise: ReturnType<typeof submitReport>) {
  const result = await promise;
  if (result.kind !== 'accepted') throw new Error(`Se esperaba aceptado y llegó ${result.kind}`);
  return result;
}

describe('submitReport', () => {
  it('crea un incidente comunitario con la confianza inicial y lo publica', async () => {
    const { bus, events } = recordingBus();
    const point = spot();

    const result = await accepted(submitReport(db, bus, report({ deviceId: newDevice(), point })));

    expect(result.outcome).toBe('created');
    expect(result.incident.confidence).toBeCloseTo(PARAMS.initialConfidence.community);
    expect(result.incident.severity).toBe(5);
    expect(result.incident.location).toMatchObject({ kind: 'point' });
    expect(events).toEqual([{ name: 'incident.created', incidentId: result.incident.id }]);
  });

  it('un reintento con el mismo clientId no cuenta dos veces', async () => {
    const { bus, events } = recordingBus();
    const body = report({ deviceId: newDevice(), point: spot() });

    const first = await accepted(submitReport(db, bus, body));
    const retry = await accepted(submitReport(db, bus, body));

    expect(retry.replayed).toBe(true);
    expect(retry.incident.id).toBe(first.incident.id);
    expect(events).toHaveLength(1);
    const rows = await db.selectFrom('community_reports').select('id').where('client_id', '=', body.clientId).execute();
    expect(rows).toHaveLength(1);
  });

  it('otro usuario reportando el mismo hecho cerca lo confirma en vez de duplicarlo (RN-09)', async () => {
    const { bus, events } = recordingBus();
    const point = spot();
    const first = await accepted(submitReport(db, bus, report({ deviceId: newDevice(), point })));

    const second = await accepted(
      submitReport(db, bus, report({ deviceId: newDevice(), point: offsetMeters(point, 200), type: 'personal_theft' })),
    );

    expect(second.outcome).toBe('confirmed');
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident.confidence).toBeCloseTo(
      PARAMS.initialConfidence.community + PARAMS.confidenceAdjustments.confirm,
    );
    expect(events.map((e) => e.name)).toEqual(['incident.created', 'incident.updated']);
  });

  it('quien ya es fuente del incidente no lo confirma de nuevo', async () => {
    const { bus } = recordingBus();
    const device = newDevice();
    const point = spot();
    const first = await accepted(submitReport(db, bus, report({ deviceId: device, point })));

    const again = await accepted(submitReport(db, bus, report({ deviceId: device, point })));

    expect(again.outcome).toBe('already_counted');
    expect(again.incident.confidence).toBeCloseTo(first.incident.confidence);
  });

  it('no fusiona tipos incompatibles ni hechos a más de 500 m', async () => {
    const { bus } = recordingBus();
    const point = spot();
    const base = await accepted(
      submitReport(db, bus, report({ deviceId: newDevice(), point, type: 'motorcycle_theft' })),
    );

    const otherType = await accepted(
      submitReport(db, bus, report({ deviceId: newDevice(), point, type: 'bicycle_theft' })),
    );
    const tooFar = await accepted(
      submitReport(db, bus, report({ deviceId: newDevice(), point: offsetMeters(point, 800), type: 'motorcycle_theft' })),
    );

    expect(otherType.outcome).toBe('created');
    expect(tooFar.outcome).toBe('created');
    expect(new Set([base.incident.id, otherType.incident.id, tooFar.incident.id]).size).toBe(3);
  });

  it('un barrio que contiene el punto lo absorbe, una localidad no', async () => {
    const { bus } = recordingBus();
    const point = spot();
    const box = (d: number) =>
      sql`ST_MakeEnvelope(${point.lng - d}, ${point.lat - d}, ${point.lng + d}, ${point.lat + d}, 4326)`;
    const insertArea = (kind: 'neighborhood' | 'locality') =>
      db
        .insertInto('incidents')
        .values({
          type: 'fight',
          severity: 2,
          location_kind: kind,
          location_name: `Prueba ${kind}`,
          geom: box(kind === 'neighborhood' ? 0.01 : 0.03),
          occurred_at: new Date(),
          time_known: false,
          confidence: 0.35,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    const locality = await insertArea('locality');
    const intoLocality = await accepted(submitReport(db, bus, report({ deviceId: newDevice(), point, type: 'assault' })));
    expect(intoLocality.outcome).toBe('created');
    expect(intoLocality.incident.id).not.toBe(locality.id);

    const neighborhood = await insertArea('neighborhood');
    const otherSpot = offsetMeters(point, 900);
    const intoNeighborhood = await accepted(
      submitReport(db, bus, report({ deviceId: newDevice(), point: otherSpot, type: 'homicide' })),
    );
    expect(intoNeighborhood.incident.id).toBe(neighborhood.id);
  });

  it(`acepta como máximo ${PARAMS.reportRateLimit.max} reportes por hora por dispositivo (RN-04)`, async () => {
    const { bus } = recordingBus();
    const device = newDevice();
    const results = [];
    for (let i = 0; i < PARAMS.reportRateLimit.max + 1; i++) {
      results.push(await submitReport(db, bus, report({ deviceId: device, point: spot() })));
    }

    expect(results.slice(0, -1).every((r) => r.kind === 'accepted')).toBe(true);
    expect(results.at(-1)?.kind).toBe('rate_limited');
  });
});

describe('submitReport con envíos simultáneos', () => {
  it('el límite por hora se cumple aunque lleguen 10 reportes a la vez', async () => {
    const { bus } = recordingBus();
    const device = newDevice();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => submitReport(db, bus, report({ deviceId: device, point: spot() }))),
    );

    expect(results.filter((r) => r.kind === 'accepted')).toHaveLength(PARAMS.reportRateLimit.max);
    expect(results.filter((r) => r.kind === 'rate_limited')).toHaveLength(10 - PARAMS.reportRateLimit.max);
  });

  it('cinco personas reportando el mismo hecho a la vez dejan un solo incidente', async () => {
    const { bus } = recordingBus();
    const point = spot();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => accepted(submitReport(db, bus, report({ deviceId: newDevice(), point })))),
    );

    expect(new Set(results.map((r) => r.incident.id)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'confirmed')).toHaveLength(4);
    const final = await db
      .selectFrom('incidents')
      .select('confidence')
      .where('id', '=', results[0]!.incident.id)
      .executeTakeFirstOrThrow();
    expect(final.confidence).toBeCloseTo(
      PARAMS.initialConfidence.community + 4 * PARAMS.confidenceAdjustments.confirm,
      5,
    );
  });
});
