import { PARAMS, riskLevelOf, ROUTE_KINDS, timeBandOf, type RouteOption, type RouteRequest } from '@urbansafe/shared';
import pLimit from 'p-limit';
import type { Db } from '../../shared/db';
import { createTtlCache } from './route-cache';
import { nearestVertexIds, queryRoutes, type RoutePath } from './routing.repository';

const metersPerSecond = (PARAMS.motorcycleSpeedKmh * 1000) / 3600;

// La cola de ruteo está llena: mejor responder enseguida que hacer esperar segundos.
export class RoutingBusyError extends Error {
  constructor() {
    super('La cola de ruteo está llena');
  }
}

export type RoutingService = ReturnType<typeof createRoutingService>;

export type RouteAlphas = { fastest: number; balanced: number; safest: number };

// RN-13: el recargo de las zonas a evitar solo lo lleva la ruta segura.
const DEFAULT_AVOID_FACTORS: RouteAlphas = { fastest: 0, balanced: 0, safest: PARAMS.avoidZone.penalty };

// `db` debe ser un pool propio con el statement_timeout del ruteo ya puesto en la sesión: fijarlo
// por pedido cuesta dos idas y vueltas más a la base, que con la base en otra región pesan más que
// el Dijkstra.
export function createRoutingService(
  db: Db,
  {
    concurrency,
    maxQueue,
    alphas = PARAMS.routeAlpha,
    avoidFactors = DEFAULT_AVOID_FACTORS,
  }: { concurrency: number; maxQueue: number; alphas?: RouteAlphas; avoidFactors?: RouteAlphas },
) {
  const limit = pLimit(concurrency);
  const alphaList = ROUTE_KINDS.map((kind) => alphas[kind]);
  const avoidList = ROUTE_KINDS.map((kind) => avoidFactors[kind]);
  const cache = createTtlCache<RouteOption[]>({ ttlMs: PARAMS.routeCache.ttlMs, maxEntries: PARAMS.routeCache.maxEntries });
  let riskVersion = 0;

  function cacheKey(fromId: string, toId: string, band: number): string {
    return `${riskVersion}:${fromId}:${toId}:${band}:${alphaList.join(',')}:${avoidList.join(',')}`;
  }

  async function planRoutes(request: RouteRequest, now = new Date()): Promise<RouteOption[] | null> {
    if (limit.pendingCount >= maxQueue) throw new RoutingBusyError();
    const band = timeBandOf(now);
    return limit(async () => {
      const version = riskVersion;
      const nodes = await nearestVertexIds(db, request.from, request.to);
      if (!nodes) return null;
      const key = cacheKey(nodes.fromId, nodes.toId, band);
      const cached = version === riskVersion ? cache.get(key) : undefined;
      if (cached) return cached;

      let paths: (RoutePath | null)[] = [];
      for (const marginM of PARAMS.routeClipMarginsM) {
        paths = await queryRoutes(db, { from: request.from, to: request.to, marginM, alphas: alphaList, avoidFactors: avoidList, band });
        if (paths.every(Boolean)) break;
      }
      if (!paths.every(Boolean)) return null;

      const routes = ROUTE_KINDS.map((kind, index) => {
        const found = paths[index]!;
        return {
          kind,
          lengthM: found.lengthM,
          durationS: found.lengthM / metersPerSecond,
          riskScore: found.riskScore,
          riskLevel: riskLevelOf(found.riskScore),
          nearbyIncidentIds: found.nearbyIncidentIds,
          path: found.path,
          segments: found.segments,
          hotIncidents: found.hotIncidents,
        };
      });
      if (version === riskVersion) cache.set(key, routes);
      return routes;
    });
  }

  return {
    planRoutes,
    invalidateCache() {
      riskVersion += 1;
      cache.clear();
    },
  };
}
