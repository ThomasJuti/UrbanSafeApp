import { randomUUID } from 'node:crypto';
import { createReportResponseSchema, deliveryStateResponseSchema, isInsideUrbanArea, type DeliveryState, type LatLng } from '@urbansafe/shared';
import { io, type Socket } from 'socket.io-client';

// 30 domiciliarios y reporteros a la vez contra un API ya corriendo: pnpm load:demo [url].
// Mide la ráfaga al aceptar (presupuesto 1,5 s) y cuánto tarda un reporte en verse por el socket
// (presupuesto 1 s). Un reporte se pone sobre la ruta de la primera sesión para cronometrar la alerta.
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const SESSIONS = 30;
const REPORTS = 30;
const BUDGET_ROUTE_MS = 1500;
const BUDGET_REPORT_MS = 1000;
const BUDGET_ALERT_MS = 2000;
const SPEED = 20;
const RIDE_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MS = 2000;

type Sample = { ms: number; ok: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => min + Math.random() * (max - min);

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function report(label: string, samples: Sample[], budgetMs: number | null) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const failed = samples.filter((sample) => !sample.ok).length;
  const p95 = percentile(sorted, 95);
  const meets = budgetMs === null || (p95 < budgetMs && failed === 0);
  console.log(
    `${label}: ${samples.length} pedidos, ${failed} fallidos · p50 ${Math.round(percentile(sorted, 50))} ms · ` +
      `p95 ${Math.round(p95)} ms · máx ${Math.round(sorted.at(-1) ?? 0)} ms` +
      (budgetMs === null ? '' : ` · ${meets ? 'cumple' : 'NO cumple'} (< ${budgetMs} ms)`),
  );
  return { p95, failed, meets };
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown; ms: number }> {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => null), ms: performance.now() - started };
  } catch {
    return { status: 0, json: null, ms: performance.now() - started };
  }
}

function stateOf(json: unknown): DeliveryState | null {
  const parsed = deliveryStateResponseSchema.safeParse(json);
  return parsed.success ? parsed.data.state : null;
}

function urbanPoint(): LatLng {
  const point = { lng: random(-74.17, -74.05), lat: random(4.6, 4.7) };
  return isInsideUrbanArea(point) ? point : { lng: -74.08, lat: 4.65 };
}

function pointAhead(path: [number, number][]): LatLng {
  const index = Math.min(path.length - 1, Math.max(1, Math.floor(path.length / 5)));
  const [lng, lat] = path[index] ?? path[0]!;
  return { lng, lat };
}

console.log(`Carga conjunta: ${SESSIONS} sesiones y ${REPORTS} reportes contra ${BASE_URL}…`);

const seenAt = new Map<string, number>();
const alertsAt = new Map<string, number>();
const socket: Socket = io(BASE_URL, { transports: ['websocket'] });
await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
socket.on('incident.created', (payload: { incident: { id: string } }) => {
  if (!seenAt.has(payload.incident.id)) seenAt.set(payload.incident.id, performance.now());
});
socket.on('alert.raised', (payload: { incident: { id: string } }) => {
  if (!alertsAt.has(payload.incident.id)) alertsAt.set(payload.incident.id, performance.now());
});

const created = await Promise.all(
  Array.from({ length: SESSIONS }, async (): Promise<{ id: string | null; sample: Sample }> => {
    const result = await post('/api/delivery/sessions', {});
    const state = stateOf(result.json);
    return { id: state?.sessionId ?? null, sample: { ms: result.ms, ok: result.status === 201 && state !== null } };
  }),
);
report('Crear', created.map((session) => session.sample), null);

const ids = created.flatMap((session) => (session.id ? [session.id] : []));
console.log(`Ráfaga: ${ids.length} aceptaciones a la vez…`);
const accepted = await Promise.all(
  ids.map(async (id) => {
    const result = await post(`/api/delivery/sessions/${id}/accept`, {});
    const state = stateOf(result.json);
    return { id, state, sample: { ms: result.ms, ok: state?.status === 'choosing' || state?.status === 'failed' } };
  }),
);
report('Aceptar', accepted.map((session) => session.sample), BUDGET_ROUTE_MS);

const riding = accepted.filter((session) => session.state?.status === 'choosing');
const first = riding[0];
if (first) {
  await new Promise<boolean>((resolve) => socket.emit('delivery.join', { sessionId: first.id }, resolve));
}
await Promise.all(
  riding.map(async (session) => {
    await post(`/api/delivery/sessions/${session.id}/speed`, { multiplier: SPEED });
    await post(`/api/delivery/sessions/${session.id}/route`, { kind: 'safest' });
  }),
);

const onPath = first?.state?.options.find((option) => option.kind === 'safest')?.path;
const points = [
  ...(onPath ? [pointAhead(onPath)] : []),
  ...Array.from({ length: REPORTS - (onPath ? 1 : 0) }, urbanPoint),
];

console.log(`Reportes: ${points.length} a la vez…`);
const posted = await Promise.all(
  points.map(async (point, index) => {
    const started = performance.now();
    const result = await post('/api/reports', {
      clientId: randomUUID(),
      deviceId: randomUUID(),
      nickname: `carga${index}`,
      type: 'armed_robbery',
      point,
    });
    const parsed = createReportResponseSchema.safeParse(result.json);
    return {
      id: parsed.success ? parsed.data.incident.id : null,
      started,
      onPath: index === 0 && onPath !== undefined,
      sample: { ms: result.ms, ok: (result.status === 201 || result.status === 200) && parsed.success },
    };
  }),
);
report('Enviar reporte', posted.map((item) => item.sample), null);

await sleep(BUDGET_ALERT_MS + 500);
const visible = posted.flatMap((item) => {
  if (!item.id) return [];
  const at = seenAt.get(item.id);
  return [{ ms: at === undefined ? BUDGET_REPORT_MS : at - item.started, ok: at !== undefined }];
});
report('Reporte visible en el socket', visible, BUDGET_REPORT_MS);

const alertSamples = posted.flatMap((item) => {
  if (!item.onPath || !item.id) return [];
  const at = alertsAt.get(item.id);
  return [{ ms: at === undefined ? BUDGET_ALERT_MS : at - item.started, ok: at !== undefined }];
});
if (alertSamples.length > 0) {
  const sample = alertSamples[0]!;
  console.log(
    `Alerta sobre la ruta: ${sample.ok ? `${Math.round(sample.ms)} ms` : 'no llegó'} · ` +
      (sample.ok && sample.ms < BUDGET_ALERT_MS ? 'cumple' : 'NO cumple') +
      ` (< ${BUDGET_ALERT_MS} ms)`,
  );
}

const pending = new Set(riding.map((session) => session.id));
const finals = new Map<string, DeliveryState['status']>();
const deadline = Date.now() + RIDE_TIMEOUT_MS;
while (pending.size > 0 && Date.now() < deadline) {
  await sleep(POLL_MS);
  await Promise.all(
    [...pending].map(async (id) => {
      const response = await fetch(`${BASE_URL}/api/delivery/sessions/${id}`, { headers: { accept: 'application/json' } });
      const state = stateOf(await response.json().catch(() => null));
      if (!state) return;
      if (state.status === 'choosing') {
        await post(`/api/delivery/sessions/${id}/route`, { kind: 'safest' });
        return;
      }
      if (state.status === 'delivered' || state.status === 'failed') {
        finals.set(id, state.status);
        pending.delete(id);
      }
    }),
  );
}
const count = (status: DeliveryState['status']) => [...finals.values()].filter((value) => value === status).length;
console.log(
  `Recorrido a ${SPEED}×: ${count('delivered')} entregadas, ${count('failed')} sin ruta, ` +
    `${pending.size} aún en camino tras ${RIDE_TIMEOUT_MS / 1000} s`,
);
socket.close();
