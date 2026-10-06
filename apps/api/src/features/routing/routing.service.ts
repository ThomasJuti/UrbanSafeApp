import { PARAMS, type RouteOption, type RouteRequest } from '@urbansafe/shared';
import pLimit from 'p-limit';
import type { RoutingConfig } from '../../shared/config';
import type { Db } from '../../shared/db';
import { findRoute, type RoutePath } from './routing.repository';

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;

export type RoutingService = ReturnType<typeof createRoutingService>;

export function createRoutingService(db: Db, config: RoutingConfig) {
  // Con 30 pedidos a la vez, sin límite el ruteo se comería el pool y frenaría todo lo demás.
  // Lo que pase del límite espera en cola.
  const limit = pLimit(config.concurrency);

  async function route(request: RouteRequest): Promise<RoutePath | null> {
    for (const marginM of PARAMS.routeClipMarginsM) {
      const found = await limit(() => findRoute(db, request.from, request.to, marginM, config.statementTimeoutMs));
      if (found) return found;
    }
    return null;
  }

  // TODO(M4): balanceada y segura cuando exista el riesgo por tramo.
  async function planRoutes(request: RouteRequest): Promise<RouteOption[] | null> {
    const fastest = await route(request);
    if (!fastest) return null;
    return [{ kind: 'fastest', lengthM: fastest.lengthM, durationS: fastest.lengthM / metersPerSecond, path: fastest.path }];
  }

  return { planRoutes };
}
