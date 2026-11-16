import { PARAMS } from '@urbansafe/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createDeliveryRoutes, type DeliveryService } from '../features/delivery';
import { createIncidentsRoutes } from '../features/incidents';
import { createBaseRiskRoutes } from '../features/open-data';
import { createReportsRoutes } from '../features/reports';
import { createEdgeRiskRoutes } from '../features/risk';
import { createRoutingRoutes, type RoutingService } from '../features/routing';
import { createSafePlacesRoutes } from '../features/safe-places';
import type { Db } from '../shared/db';
import type { EventBus } from '../shared/events';
import { createRateLimiter, rateLimit, type ClientKey } from '../shared/http';

type IpLimitName = Exclude<keyof typeof PARAMS.ipRateLimit, 'windowMs'>;

export function createApp(deps: {
  db: Db;
  bus: EventBus;
  routing: RoutingService;
  delivery: DeliveryService;
  clientKey: ClientKey;
  // Build de la web (apps/web/dist). En producción el API la sirve en el mismo dominio, así
  // /api y /socket.io no necesitan CORS. En desarrollo la sirve Vite y esto queda vacío.
  webDir?: string;
}) {
  const app = new Hono();
  const limited = (name: IpLimitName) =>
    rateLimit(createRateLimiter({ max: PARAMS.ipRateLimit[name], windowMs: PARAMS.ipRateLimit.windowMs }), deps.clientKey);

  // Solo las escrituras y lo que gasta CPU de la base; las lecturas baratas del mapa no pasan por aquí.
  app.post('/api/reports', limited('reports'));
  app.post('/api/reports/votes', limited('votes'));
  app.post('/api/routes', limited('routes'));
  app.get('/api/edge-risk', limited('edgeRisk'));
  app.post('/api/delivery/sessions', limited('deliverySessions'));
  const deliveryRouting = limited('deliveryRouting');
  app.post('/api/delivery/sessions/:id/accept', deliveryRouting);
  app.post('/api/delivery/sessions/:id/recalculate', deliveryRouting);
  app.post('/api/delivery/sessions/:id/next', deliveryRouting);

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/incidents', createIncidentsRoutes(deps.db));
  app.route('/api/base-risk', createBaseRiskRoutes(deps.db));
  app.route('/api/edge-risk', createEdgeRiskRoutes(deps.db));
  app.route('/api/safe-places', createSafePlacesRoutes(deps.db));
  app.route('/api/reports', createReportsRoutes(deps));
  app.route('/api/routes', createRoutingRoutes(deps.routing));
  app.route('/api/delivery', createDeliveryRoutes(deps.delivery));

  if (deps.webDir) {
    const root = deps.webDir;
    app.use('*', serveStatic({ root }));
    // Las rutas de React Router (/domiciliario, /reportar) caen en index.html; /api no.
    app.get('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ root, path: 'index.html' })(c, next)));
  }

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Error interno' }, 500);
  });

  return app;
}
