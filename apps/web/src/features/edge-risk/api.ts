import { edgeRiskResponseSchema, formatBbox, type Bbox, type EdgeRiskResponse } from '@urbansafe/shared';
import { getJson } from '../../shared/http';

export function fetchEdgeRisk(bbox: Bbox, signal: AbortSignal): Promise<EdgeRiskResponse> {
  const params = new URLSearchParams({ bbox: formatBbox(bbox) });
  return getJson(`/api/edge-risk?${params}`, edgeRiskResponseSchema, { signal });
}
