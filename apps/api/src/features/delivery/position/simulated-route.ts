import { haversineM, PARAMS, type LngLat } from '@urbansafe/shared';
import type { PositionSample, PositionSource } from './position-source';

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;

export type SimulatedRoute = PositionSource & { speedMultiplier: number };

// Avanza a la velocidad promedio de moto multiplicada por `speedMultiplier`, que se puede cambiar
// en cualquier momento.
export function createSimulatedRoute(path: readonly LngLat[], speedMultiplier: number): SimulatedRoute {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1]! + haversineM(path[i - 1]!, path[i]!));
  const totalM = cumulative.at(-1)!;
  let progressM = 0;
  // El avance solo crece, así que el segmento actual se busca hacia adelante desde el anterior.
  let segment = 0;

  const route: SimulatedRoute = {
    speedMultiplier,
    advance(elapsedMs) {
      progressM = Math.min(totalM, progressM + (metersPerSecond * route.speedMultiplier * elapsedMs) / 1000);
      while (segment < path.length - 2 && cumulative[segment + 1]! < progressM) segment++;
      return sample();
    },
  };

  function sample(): PositionSample {
    if (progressM >= totalM) {
      const [lng, lat] = path.at(-1)!;
      return { point: { lng, lat }, progressM, arrived: true };
    }
    const start = cumulative[segment]!;
    const end = cumulative[segment + 1] ?? start;
    const t = end > start ? (progressM - start) / (end - start) : 1;
    const a = path[segment]!;
    const b = path[segment + 1] ?? a;
    return {
      point: { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t },
      progressM,
      arrived: progressM >= totalM,
    };
  }

  return route;
}
