import { Hono } from 'hono';
import { createIncidentsRoutes } from '../features/incidents';
import type { Db } from '../shared/db';

export function createApp(deps: { db: Db }) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/incidents', createIncidentsRoutes(deps.db));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Error interno' }, 500);
  });

  return app;
}
