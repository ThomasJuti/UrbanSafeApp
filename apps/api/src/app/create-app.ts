import { Hono } from 'hono';
import { createIncidentsRoutes } from '../features/incidents';
import { createBaseRiskRoutes } from '../features/open-data';
import { createReportsRoutes } from '../features/reports';
import { createRoutingRoutes, createRoutingService } from '../features/routing';
import type { Db } from '../shared/db';
import type { EventBus } from '../shared/events';

// El ruteo usa su propio pool, con el statement_timeout del ruteo en la sesión.
export type RoutingDeps = { db: Db; concurrency: number };

export function createApp(deps: { db: Db; bus: EventBus; routing: RoutingDeps }) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/incidents', createIncidentsRoutes(deps.db));
  app.route('/api/base-risk', createBaseRiskRoutes(deps.db));
  app.route('/api/reports', createReportsRoutes(deps));
  app.route('/api/routes', createRoutingRoutes(createRoutingService(deps.routing.db, deps.routing.concurrency)));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Error interno' }, 500);
  });

  return app;
}
