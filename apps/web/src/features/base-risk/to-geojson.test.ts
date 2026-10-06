import { describe, expect, it } from 'vitest';
import { toFeatureCollection } from './to-geojson';

describe('toFeatureCollection', () => {
  it('lleva el riesgo base a las propiedades que pinta el mapa', () => {
    const geometry = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [
          [
            [-74.1, 4.6],
            [-74.09, 4.6],
            [-74.09, 4.61],
            [-74.1, 4.6],
          ] as [number, number][],
        ],
      ],
    };

    const collection = toFeatureCollection([{ code: '17', name: 'Candelaria', baseRisk: 1, geometry }]);

    expect(collection.features).toEqual([
      { type: 'Feature', id: '17', geometry, properties: { code: '17', name: 'Candelaria', baseRisk: 1 } },
    ]);
  });
});
