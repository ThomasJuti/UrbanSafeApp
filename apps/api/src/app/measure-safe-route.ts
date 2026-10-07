import { deliveryStateResponseSchema, routeResponseSchema, type RouteOption } from '@urbansafe/shared';
import { SAFE_ROUTE_VALUE, safeRouteVerdict, type SafeRouteVerdict } from '../features/delivery';

// Mide el criterio "Valor de la ruta segura" contra un API ya corriendo: pnpm measure:safe-route [url].
// Cada pedido es una sesión real (recogida y entrega sobre el grafo). Se comparan la más rápida y la
// más segura de los dos tramos, con 4 pedidos a la vez para no llenar la cola de ruteo.
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const ORDERS = 30;
const CONCURRENCY = 4;

type Outcome = { kind: 'routed'; verdict: SafeRouteVerdict } | { kind: 'no_route' } | { kind: 'failed' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  } catch {
    return { status: 0, json: null };
  }
}

function pair(options: RouteOption[]): { fastest: RouteOption; safest: RouteOption } | null {
  const fastest = options.find((option) => option.kind === 'fastest');
  const safest = options.find((option) => option.kind === 'safest');
  return fastest && safest ? { fastest, safest } : null;
}

async function oneOrder(): Promise<Outcome> {
  const created = await post('/api/delivery/sessions', {});
  const session = deliveryStateResponseSchema.safeParse(created.json);
  if (!session.success) return created.status === 503 ? { kind: 'no_route' } : { kind: 'failed' };

  const { sessionId, order } = session.data.state;
  let accepted = await post(`/api/delivery/sessions/${sessionId}/accept`, {});
  if (accepted.status === 503) {
    await sleep(2000);
    accepted = await post(`/api/delivery/sessions/${sessionId}/accept`, {});
  }
  const firstLeg = deliveryStateResponseSchema.safeParse(accepted.json);
  const toPickup = firstLeg.success ? pair(firstLeg.data.state.options) : null;
  if (!toPickup) {
    const gaveUp = accepted.status === 503 || (firstLeg.success && firstLeg.data.state.status === 'failed');
    return gaveUp ? { kind: 'no_route' } : { kind: 'failed' };
  }

  const routed = await post('/api/routes', { from: order.pickup, to: order.dropoff });
  const second = routeResponseSchema.safeParse(routed.json);
  const toDropoff = second.success ? pair(second.data.routes) : null;
  if (!toDropoff) return routed.status === 404 || routed.status === 503 ? { kind: 'no_route' } : { kind: 'failed' };

  return { kind: 'routed', verdict: safeRouteVerdict([toPickup, toDropoff]) };
}

async function allOrders(): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= ORDERS) return;
      outcomes[index] = await oneOrder();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return outcomes;
}

function percent(count: number, total: number): string {
  return total === 0 ? '0 %' : `${Math.round((count / total) * 100)} %`;
}

console.log(`Midiendo ${ORDERS} pedidos contra ${BASE_URL}…`);
const outcomes = await allOrders();
const routed = outcomes.flatMap((outcome) => (outcome.kind === 'routed' ? [outcome.verdict] : []));
const meeting = routed.filter((verdict) => verdict.meets);
const noRoute = outcomes.filter((outcome) => outcome.kind === 'no_route').length;
const failed = outcomes.filter((outcome) => outcome.kind === 'failed').length;
const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);
const reductions = routed.flatMap((verdict) => (verdict.exposureReduction === null ? [] : [verdict.exposureReduction]));

console.log(
  `${routed.length} con las dos rutas, ${noRoute} sin ruta, ${failed} fallidos · ` +
    `${meeting.length} cumplen (${percent(meeting.length, routed.length)}) · ` +
    `exposición evitada media ${Math.round(mean(reductions) * 100)} % · ` +
    `tiempo extra medio ${Math.round(mean(routed.map((verdict) => verdict.extraTimeRatio)) * 100)} % · ` +
    (routed.length > 0 && meeting.length / routed.length >= SAFE_ROUTE_VALUE.minOrderShare ? 'cumple' : 'NO cumple'),
);
