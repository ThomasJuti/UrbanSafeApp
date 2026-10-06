import { PARAMS, riskLevelOf, ROUTE_KINDS, timeBandOf, type RouteOption, type RouteRequest } from '@urbansafe/shared';
import pLimit from 'p-limit';
import type { Db } from '../../shared/db';
import { queryRoutes, type RoutePath } from './routing.repository';

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;
const ALPHAS = ROUTE_KINDS.map((kind) => PARAMS.routeAlpha[kind]);

export type RoutingService = ReturnType<typeof createRoutingService>;

// `db` debe ser un pool propio con el statement_timeout del ruteo ya puesto en la sesión: fijarlo
// por pedido cuesta dos idas y vueltas más a la base, que con la base en otra región pesan más que
// el Dijkstra.
export function createRoutingService(db: Db, concurrency: number) {
  // Con 30 pedidos a la vez, sin límite el ruteo se comería el pool y la CPU de la base y frenaría
  // todo lo demás. Lo que pase del límite espera en cola.
  const limit = pLimit(concurrency);

  async function planRoutes(request: RouteRequest, now = new Date()): Promise<RouteOption[] | null> {
    const band = timeBandOf(now);
    let paths: (RoutePath | null)[] = [];
    for (const marginM of PARAMS.routeClipMarginsM) {
      const query = { from: request.from, to: request.to, marginM, alphas: ALPHAS, band };
      paths = await limit(() => queryRoutes(db, query));
      if (paths.every(Boolean)) break;
    }
    if (!paths.every(Boolean)) return null;

    return ROUTE_KINDS.map((kind, index) => {
      const found = paths[index]!;
      return {
        kind,
        lengthM: found.lengthM,
        durationS: found.lengthM / metersPerSecond,
        riskScore: found.riskScore,
        riskLevel: riskLevelOf(found.riskScore),
        nearbyIncidentIds: found.nearbyIncidentIds,
        path: found.path,
      };
    });
  }

  return { planRoutes };
}
