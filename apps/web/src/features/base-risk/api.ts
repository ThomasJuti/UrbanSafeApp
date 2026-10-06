import { baseRiskResponseSchema, type BaseRiskResponse } from '@urbansafe/shared';
import { getJson } from '../../shared/http';

export function fetchBaseRisk(signal: AbortSignal): Promise<BaseRiskResponse> {
  return getJson('/api/base-risk', baseRiskResponseSchema, { signal });
}
