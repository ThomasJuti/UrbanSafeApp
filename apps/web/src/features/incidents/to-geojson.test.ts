import type { MapIncident } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { toFeatureCollection } from './to-geojson';

const base = {
  type: 'armed_robbery',
  severity: 5,
  occurredAt: '2026-10-04T20:00:00.000Z',
  timeKnown: true,
  confidence: 0.7,
} as const;

describe('toFeatureCollection', () => {
  it('usa [lng, lat] como exige GeoJSON, también para áreas', () => {
    const incidents: MapIncident[] = [
      { ...base, id: '1', location: { kind: 'point', point: { lat: 4.6, lng: -74.07 } } },
      {
        ...base,
        id: '2',
        location: { kind: 'area', level: 'neighborhood', name: 'Chapinero', point: { lat: 4.64, lng: -74.06 } },
      },
    ];

    const { features } = toFeatureCollection(incidents);

    expect(features.map((f) => f.geometry.coordinates)).toEqual([
      [-74.07, 4.6],
      [-74.06, 4.64],
    ]);
    expect(features[0]?.properties).toMatchObject({ id: '1', severity: 5 });
  });
});
