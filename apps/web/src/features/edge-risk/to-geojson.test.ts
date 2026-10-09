import { describe, expect, it } from 'vitest';
import { toFeatureCollection } from './to-geojson';

describe('toFeatureCollection (M8)', () => {
  it('convierte cada tramo en una línea con su riesgo', () => {
    const collection = toFeatureCollection([
      {
        risk: 0.4,
        path: [
          [-74.06, 4.65],
          [-74.05, 4.66],
        ],
      },
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({ risk: 0.4 });
    expect(collection.features[0]?.geometry.coordinates).toHaveLength(2);
  });
});
