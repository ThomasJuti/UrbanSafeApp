import type { SafePlace } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { nearestSafePlace } from './nearest-safe-place';

const place = (id: string, lat: number, lng: number): SafePlace => ({ id, kind: 'police', name: null, point: { lat, lng } });

describe('nearestSafePlace (M6)', () => {
  const places = [place('far', 4.7, -74.1), place('near', 4.651, -74.06), place('mid', 4.66, -74.06)];

  it('devuelve el punto más cercano con su distancia en metros', () => {
    const found = nearestSafePlace(places, { lat: 4.65, lng: -74.06 });

    expect(found?.place.id).toBe('near');
    expect(found?.distanceM).toBeCloseTo(111, -1);
  });

  it('devuelve null si no hay puntos', () => {
    expect(nearestSafePlace([], { lat: 4.65, lng: -74.06 })).toBeNull();
  });
});
