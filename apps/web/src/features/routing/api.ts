import { routeResponseSchema, type RouteOption, type RouteRequest } from '@urbansafe/shared';
import { postJson } from '../../shared/http';

const NOT_FOUND = 404;

export type PlanResult = { kind: 'found'; routes: RouteOption[] } | { kind: 'no_route' } | { kind: 'failed' };

export async function planRoutes(request: RouteRequest): Promise<PlanResult> {
  try {
    const result = await postJson('/api/routes', request, routeResponseSchema);
    if (result.ok) return { kind: 'found', routes: result.data.routes };
    return result.status === NOT_FOUND ? { kind: 'no_route' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
