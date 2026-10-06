import { randomUUID } from 'node:crypto';
import type { CreateReportBody, PublicServerEvents } from '@urbansafe/shared';
import { sql } from 'kysely';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../shared/db';
import { startServer } from './start-server';

const POINT = { lat: 1.5, lng: 1.5 };
const deviceId = randomUUID();

let db: Db;
let server: Awaited<ReturnType<typeof startServer>>;
let client: Socket<PublicServerEvents>;

beforeAll(async () => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 2, statementTimeoutMs: 15_000 }).db;
  server = await startServer({ db, port: 0, routing: { db, concurrency: 2 }, backgroundJobs: false });
  client = io(`http://localhost:${server.port}`, { transports: ['websocket'] });
  await new Promise<void>((resolve) => client.on('connect', resolve));
});

afterAll(async () => {
  client?.close();
  await server?.close();
  if (!db) return;
  await db
    .deleteFrom('incidents')
    .where(sql<boolean>`ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${POINT.lng}, ${POINT.lat}), 4326)::geography, 1000)`)
    .execute();
  await db.deleteFrom('reporters').where('device_id', '=', deviceId).execute();
  await db.destroy();
});

describe('servidor', () => {
  it('un reporte enviado por HTTP llega por socket a los mapas conectados', async () => {
    const received = new Promise<{ id: string; at: number }>((resolve) => {
      client.once('incident.created', ({ incident }) => resolve({ id: incident.id, at: performance.now() }));
    });
    const body: CreateReportBody = { clientId: randomUUID(), deviceId, nickname: 'tester', type: 'fight', point: POINT };

    const sentAt = performance.now();
    const response = await fetch(`http://localhost:${server.port}/api/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const { incident } = (await response.json()) as { incident: { id: string } };
    const event = await received;

    expect(response.status).toBe(201);
    expect(event.id).toBe(incident.id);
    console.log(`Reporte → evento en el socket: ${Math.round(event.at - sentAt)} ms`);
  });

  it('rechaza un reporte mal formado con 400', async () => {
    const response = await fetch(`http://localhost:${server.port}/api/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'no-es-uuid', type: 'fight' }),
    });
    expect(response.status).toBe(400);
  });
});
