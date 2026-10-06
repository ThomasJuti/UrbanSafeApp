import { deliveryStateResponseSchema, type DeliveryState } from '@urbansafe/shared';

// 30 sesiones de entrega a la vez contra un API ya corriendo: pnpm load:delivery [url].
// La ráfaga acepta las 30 juntas (cada aceptación calcula las 3 rutas: presupuesto 1,5 s).
// Después todas recorren la más segura a 20×, para ver si el ticker y el segundo tramo aguantan.
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const SESSIONS = 30;
const BUDGET_MS = 1500;
const SPEED = 20;
const RIDE_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MS = 2000;

type Sample = { ms: number; ok: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function report(label: string, samples: Sample[], budget: boolean) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const failed = samples.filter((sample) => !sample.ok).length;
  const p95 = percentile(sorted, 95);
  const meets = !budget || (p95 < BUDGET_MS && failed === 0);
  console.log(
    `${label}: ${samples.length} pedidos, ${failed} fallidos · p50 ${Math.round(percentile(sorted, 50))} ms · ` +
      `p95 ${Math.round(p95)} ms · máx ${Math.round(sorted.at(-1) ?? 0)} ms` +
      (budget ? ` · ${meets ? 'cumple' : 'NO cumple'}` : ''),
  );
}

console.log(`Creando ${SESSIONS} sesiones contra ${BASE_URL}…`);
const created = await Promise.all(
  Array.from({ length: SESSIONS }, async (): Promise<{ id: string | null; sample: Sample }> => {
    const result = await post('/api/delivery/sessions', {});
    const state = stateOf(result.json);
    return { id: state?.sessionId ?? null, sample: { ms: result.ms, ok: result.status === 201 && state !== null } };
  }),
);
report('Crear', created.map((session) => session.sample), false);

const ids = created.flatMap((session) => (session.id ? [session.id] : []));
console.log(`Ráfaga: ${ids.length} aceptaciones a la vez…`);
const accepted = await Promise.all(
  ids.map(async (id): Promise<{ id: string; state: DeliveryState | null; sample: Sample }> => {
    const result = await post(`/api/delivery/sessions/${id}/accept`, {});
    const state = stateOf(result.json);
    return { id, state, sample: { ms: result.ms, ok: state?.status === 'choosing' || state?.status === 'failed' } };
  }),
);
report('Aceptar', accepted.map((session) => session.sample), true);

const riding = accepted.filter((session) => session.state?.status === 'choosing');
await Promise.all(
  riding.map(async (session) => {
    await post(`/api/delivery/sessions/${session.id}/speed`, { multiplier: SPEED });
    await post(`/api/delivery/sessions/${session.id}/route`, { kind: 'safest' });
  }),
);

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
      // El segundo tramo vuelve a 'choosing': hay que elegir otra vez, igual que el primero.
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
