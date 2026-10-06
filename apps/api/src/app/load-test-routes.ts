import { isInsideUrbanArea, routeResponseSchema, type LatLng } from '@urbansafe/shared';

// Prueba de carga del presupuesto de M5 (3 rutas < 1,5 s p95 con 30 usuarios) contra un API
// que ya esté corriendo: pnpm load:routes [url].
// - Sostenida: cada usuario pide rutas, espera entre pedidos y vuelve a pedir.
// - Ráfaga: los 30 piden a la vez, el peor caso.
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const USERS = 30;
const SUSTAINED_MS = 60_000;
const THINK_MS = { min: 5_000, max: 15_000 };
const BUDGET_MS = 1500;
// Trayectos típicos de domicilio, desde el centro ampliado de la ciudad.
const TRIP_M = { min: 2_000, max: 8_000 };
const ORIGIN_BOX = { minLng: -74.17, maxLng: -74.03, minLat: 4.57, maxLat: 4.76 };
const METERS_PER_DEGREE = 111_320;

const random = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function randomTrip(): { from: LatLng; to: LatLng } {
  for (;;) {
    const from = { lng: random(ORIGIN_BOX.minLng, ORIGIN_BOX.maxLng), lat: random(ORIGIN_BOX.minLat, ORIGIN_BOX.maxLat) };
    const distance = random(TRIP_M.min, TRIP_M.max) / METERS_PER_DEGREE;
    const bearing = random(0, 2 * Math.PI);
    const to = { lng: from.lng + distance * Math.cos(bearing), lat: from.lat + distance * Math.sin(bearing) };
    if (isInsideUrbanArea(to)) return { from, to };
  }
}

type Sample = { ms: number; ok: boolean };

async function requestRoutes(): Promise<Sample> {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}/api/routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(randomTrip()),
    });
    // 404 es "no hay ruta" (un punto en un parque, por ejemplo): respuesta válida y medida.
    const ok = response.ok ? routeResponseSchema.safeParse(await response.json()).success : response.status === 404;
    return { ms: performance.now() - started, ok };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function report(label: string, samples: Sample[]) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const failed = samples.filter((sample) => !sample.ok).length;
  const p95 = percentile(sorted, 95);
  console.log(
    `${label}: ${samples.length} pedidos, ${failed} fallidos · p50 ${Math.round(percentile(sorted, 50))} ms · ` +
      `p95 ${Math.round(p95)} ms · máx ${Math.round(sorted.at(-1) ?? 0)} ms · ` +
      (p95 < BUDGET_MS && failed === 0 ? 'cumple' : 'NO cumple'),
  );
}

async function sustained(): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + SUSTAINED_MS;
  await Promise.all(
    Array.from({ length: USERS }, async () => {
      await sleep(random(0, THINK_MS.max));
      while (Date.now() < deadline) {
        samples.push(await requestRoutes());
        await sleep(random(THINK_MS.min, THINK_MS.max));
      }
    }),
  );
  return samples;
}

console.log(`Carga sostenida: ${USERS} usuarios durante ${SUSTAINED_MS / 1000} s contra ${BASE_URL}…`);
report('Sostenida', await sustained());
console.log(`Ráfaga: ${USERS} pedidos simultáneos…`);
report('Ráfaga', await Promise.all(Array.from({ length: USERS }, requestRoutes)));
