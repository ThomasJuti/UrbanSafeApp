import { zValidator } from '@hono/zod-validator';
import { ROUTE_ERRORS, routeRequestSchema, type RouteResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import { RoutingBusyError, type RoutingService } from './routing.service';

const BUSY_RETRY_AFTER_S = 2;

export function createRoutingRoutes(service: RoutingService) {
  return new Hono().post('/', zValidator('json', routeRequestSchema), async (c) => {
    const started = performance.now();
    try {
      const routes = await service.planRoutes(c.req.valid('json'));
      console.log(`Ruteo en ${Math.round(performance.now() - started)} ms`);
      if (!routes) return c.json({ error: ROUTE_ERRORS.noRoute }, 404);
      return c.json({ routes } satisfies RouteResponse, 200);
    } catch (error) {
      if (!(error instanceof RoutingBusyError)) throw error;
      c.header('Retry-After', String(BUSY_RETRY_AFTER_S));
      return c.json({ error: ROUTE_ERRORS.busy }, 503);
    }
  });
}
