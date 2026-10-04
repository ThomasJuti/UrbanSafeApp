import type { MapIncident } from '@urbansafe/shared';
import type { FeatureCollection, Point } from 'geojson';

export type IncidentFeatureProps = Pick<MapIncident, 'id' | 'type' | 'severity' | 'confidence' | 'occurredAt'>;

export function toFeatureCollection(incidents: MapIncident[]): FeatureCollection<Point, IncidentFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: incidents.map((incident) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [incident.location.point.lng, incident.location.point.lat],
      },
      properties: {
        id: incident.id,
        type: incident.type,
        severity: incident.severity,
        confidence: incident.confidence,
        occurredAt: incident.occurredAt,
      },
    })),
  };
}
