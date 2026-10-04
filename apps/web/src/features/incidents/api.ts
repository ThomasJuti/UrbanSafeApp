import { formatBbox, listIncidentsResponseSchema, type Bbox, type MapIncident } from '@urbansafe/shared';
import { getJson } from '../../shared/http';

export async function fetchIncidents(bbox: Bbox, signal: AbortSignal): Promise<MapIncident[]> {
  const params = new URLSearchParams({ bbox: formatBbox(bbox) });
  const { incidents } = await getJson(`/api/incidents?${params}`, listIncidentsResponseSchema, { signal });
  return incidents;
}
