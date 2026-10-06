import { describe, expect, it } from 'vitest';
import { routeRequestSchema } from './routes';

const chapinero = { lat: 4.6486, lng: -74.0628 };
const kennedy = { lat: 4.6283, lng: -74.1527 };

describe('routeRequestSchema (M5)', () => {
  it('acepta origen y destino dentro del casco urbano', () => {
    expect(routeRequestSchema.safeParse({ from: chapinero, to: kennedy }).success).toBe(true);
  });

  it('rechaza puntos fuera del casco urbano, como Sumapaz', () => {
    const sumapaz = { lat: 4.05, lng: -74.3 };
    expect(routeRequestSchema.safeParse({ from: chapinero, to: sumapaz }).success).toBe(false);
  });
});
