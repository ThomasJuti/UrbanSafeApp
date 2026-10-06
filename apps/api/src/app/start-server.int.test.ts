import { randomUUID } from 'node:crypto';
import type { ClientEvents, CreateReportBody, DeliveryStateResponse, DomainEvents, ServerEvents } from '@urbansafe/shared';
import { sql } from 'kysely';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../shared/db';
import { startServer } from './start-server';

const POINT = { lat: 1.5, lng: 1.5 };
const deviceId = randomUUID();
// Con el ticker a 1 Hz, una posición llega antes de esto.
const POSITION_WAIT_MS = 3000;

type ClientSocket = Socket<ServerEvents, ClientEvents>;

let db: Db;
let server: Awaited<ReturnType<typeof startServer>>;
let client: ClientSocket;
const extraSockets: ClientSocket[] = [];

const url = (path: string) => `http://localhost:${server.port}${path}`;

async function connect(): Promise<ClientSocket> {
  const socket: ClientSocket = io(url(''), { transports: ['websocket'] });
  extraSockets.push(socket);
  await new Promise<void>((resolve) => socket.on('connect', resolve));
  return socket;
}

const join = (socket: ClientSocket, sessionId: string) =>
  new Promise<boolean>((resolve) => socket.emit('delivery.join', { sessionId }, resolve));

async function post(path: string, body?: unknown) {
  const response = await fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: (await response.json()) as DeliveryStateResponse };
}

function collectPositions(socket: ClientSocket) {
  const received: DomainEvents['delivery.position'][] = [];
  socket.on('delivery.position', (payload) => received.push(payload));
  return received;
}

beforeAll(async () => {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (!databaseUrl) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url: databaseUrl, poolSize: 4, statementTimeoutMs: 15_000 }).db;
  server = await startServer({ db, port: 0, routing: { db, concurrency: 2 }, backgroundJobs: false });
  client = await connect();
});

afterAll(async () => {
  for (const socket of extraSockets) socket.close();
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
    const response = await fetch(url('/api/reports'), {
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
    const response = await fetch(url('/api/reports'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'no-es-uuid', type: 'fight' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('entrega simulada por HTTP y socket (M7, RN-03)', () => {
  it('acepta, elige ruta y la posición llega solo a la sala de su sesión', async () => {
    const [own, other, bystander] = await Promise.all([connect(), connect(), connect()]);
    const created = await post('/api/delivery/sessions');
    const otherSession = await post('/api/delivery/sessions');
    const sessionId = created.body.state.sessionId;

    expect(created.status).toBe(201);
    expect(await join(own, sessionId)).toBe(true);
    expect(await join(other, otherSession.body.state.sessionId)).toBe(true);
    expect(await join(bystander, randomUUID())).toBe(false);

    const accepted = await post(`/api/delivery/sessions/${sessionId}/accept`);
    expect(accepted.body.state.status).toBe('choosing');
    expect(accepted.body.state.options).toHaveLength(3);

    const ownPositions = collectPositions(own);
    const otherPositions = collectPositions(other);
    const bystanderPositions = collectPositions(bystander);
    const chosen = await post(`/api/delivery/sessions/${sessionId}/route`, { kind: 'safest' });
    expect(chosen.body.state).toMatchObject({ status: 'riding', chosen: 'safest' });

    await new Promise((resolve) => setTimeout(resolve, POSITION_WAIT_MS));

    expect(ownPositions.length).toBeGreaterThan(0);
    expect(ownPositions.every((position) => position.sessionId === sessionId)).toBe(true);
    expect(otherPositions).toEqual([]);
    expect(bystanderPositions).toEqual([]);
  });

  it('responde 404 a una sesión que no existe y 409 a un comando fuera de turno', async () => {
    const missing = await post(`/api/delivery/sessions/${randomUUID()}/accept`);
    const created = await post('/api/delivery/sessions');
    const early = await post(`/api/delivery/sessions/${created.body.state.sessionId}/route`, { kind: 'fastest' });

    expect(missing.status).toBe(404);
    expect(early.status).toBe(409);
  });
});
