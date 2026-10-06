import { haversineM, PARAMS, type LngLat } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { createSimulatedRoute } from './simulated-route';

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;
// Dos segmentos hacia el norte de ~111 m cada uno.
const PATH: LngLat[] = [
  [-74.1, 4.6],
  [-74.1, 4.601],
  [-74.1, 4.602],
];
const TOTAL_M = haversineM(PATH[0]!, PATH[2]!);

describe('ruta simulada (fuente de posición)', () => {
  it('avanza a la velocidad de moto por el multiplicador e interpola dentro del segmento', () => {
    const route = createSimulatedRoute(PATH, 1);
    const sample = route.advance(10_000);

    expect(sample.progressM).toBeCloseTo(metersPerSecond * 10, 6);
    expect(sample.point.lng).toBeCloseTo(-74.1, 9);
    expect(haversineM(PATH[0]!, [sample.point.lng, sample.point.lat])).toBeCloseTo(sample.progressM, 0);
    expect(sample.arrived).toBe(false);
  });

  it('pasa al segundo segmento y cambiar el multiplicador acelera desde ese momento', () => {
    const route = createSimulatedRoute(PATH, 1);
    route.advance(10_000);
    route.speedMultiplier = 10;
    const sample = route.advance(2_000);

    expect(sample.progressM).toBeCloseTo(metersPerSecond * (10 + 20), 6);
    expect(sample.point.lat).toBeGreaterThan(4.601);
  });

  it('se detiene en el final y avisa que llegó', () => {
    const route = createSimulatedRoute(PATH, 20);
    const sample = route.advance(60_000);

    expect(sample.progressM).toBeCloseTo(TOTAL_M, 6);
    expect(sample.point).toEqual({ lng: -74.1, lat: 4.602 });
    expect(sample.arrived).toBe(true);
  });
});
