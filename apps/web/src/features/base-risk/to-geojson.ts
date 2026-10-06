import type { BaseRiskZone } from '@urbansafe/shared';
import type { FeatureCollection, MultiPolygon } from 'geojson';

export type ZoneProperties = { code: string; name: string; baseRisk: number };

export function toFeatureCollection(zones: BaseRiskZone[]): FeatureCollection<MultiPolygon, ZoneProperties> {
  return {
    type: 'FeatureCollection',
    features: zones.map(({ code, name, baseRisk, geometry }) => ({
      type: 'Feature',
      id: code,
      geometry,
      properties: { code, name, baseRisk },
    })),
  };
}
