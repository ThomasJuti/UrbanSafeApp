import type { EdgeRisk } from '@urbansafe/shared';
import type { FeatureCollection, LineString } from 'geojson';

export function toFeatureCollection(edges: EdgeRisk[]): FeatureCollection<LineString, { risk: number }> {
  return {
    type: 'FeatureCollection',
    features: edges.map(({ risk, path }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path },
      properties: { risk },
    })),
  };
}
