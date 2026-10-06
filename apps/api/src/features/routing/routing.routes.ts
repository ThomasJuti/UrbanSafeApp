import { zValidator } from '@hono/zod-validator';
import { ROUTE_ERRORS, routeRequestSchema, type RouteResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import type { RoutingService } from './routing.service';

export function createRoutingRoutes(service: RoutingService) {
  return new Hono().post('/', zValidator('json', routeRequestSchema), async (c) => {
    const started = performance.now();
    const routes = await service.planRoutes(c.req.valid('json'));
    console.log(`Ruteo en ${Math.round(performance.now() - started)} ms`);
    if (!routes) return c.json({ error: ROUTE_ERRORS.noRoute }, 404);
    return c.json({ routes } satisfies RouteResponse, 200);
  });
}
