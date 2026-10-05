import { Hono } from 'hono';
import { createIncidentsRoutes } from '../features/incidents';
import { createReportsRoutes } from '../features/reports';
import type { Db } from '../shared/db';
import type { EventBus } from '../shared/events';

export function createApp(deps: { db: Db; bus: EventBus }) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/incidents', createIncidentsRoutes(deps.db));
  app.route('/api/reports', createReportsRoutes(deps));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Error interno' }, 500);
  });

  return app;
}
