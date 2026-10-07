import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createDeliveryService, snapToRoads } from '../features/delivery';
import { createNewsIngestionFromConfig } from '../features/news-ingestion';
import { createRiskService } from '../features/risk';
import { createRoutingService } from '../features/routing';
import type { NewsIngestionConfig } from '../shared/config';
import type { Db } from '../shared/db';
import { createEventBus } from '../shared/events';
import { clientIp } from '../shared/http';
import { createRealtime } from '../shared/realtime';
import { createApp } from './create-app';

// El ruteo usa su propio pool, con el statement_timeout del ruteo en la sesión.
export type RoutingDeps = { db: Db; concurrency: number; maxQueue: number };

export async function startServer(deps: {
  db: Db;
  port: number;
  routing: RoutingDeps;
  // Recálculo de riesgo por eventos y programado. Las pruebas lo apagan para no reescribir el
  // riesgo de toda la ciudad en la base compartida.
  backgroundJobs: boolean;
  // Detrás de un proxy propio que agrega X-Forwarded-For (ver clientIp).
  trustProxy: boolean;
  // M1: corre con los trabajos de fondo y solo si están las claves del LLM y del geocodificador.
  newsIngestion?: NewsIngestionConfig;
}) {
  const bus = createEventBus();
  const stopRisk = deps.backgroundJobs ? createRiskService(deps.db).start(bus) : async () => {};
  const news =
    deps.backgroundJobs && deps.newsIngestion
      ? createNewsIngestionFromConfig({ db: deps.db, bus, config: deps.newsIngestion })
      : null;
  const routing = createRoutingService(deps.routing.db, deps.routing);
  const delivery = createDeliveryService({
    planRoutes: routing.planRoutes,
    snapToRoads: (points) => snapToRoads(deps.db, points),
    bus,
  });
  const stopTicker = delivery.start();
  const app = createApp({ db: deps.db, bus, routing, delivery, clientKey: clientIp(deps.trustProxy) });

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const server = serve({ fetch: app.fetch, port: deps.port }, () => resolve(server as HttpServer));
  });

  const realtime = createRealtime(httpServer, { canJoinDelivery: delivery.has });
  bus.subscribe('incident.created', (payload) => realtime.toPublicIncidents('incident.created', payload));
  bus.subscribe('incident.updated', (payload) => realtime.toPublicIncidents('incident.updated', payload));
  bus.subscribe('delivery.updated', (payload) =>
    realtime.toDelivery(payload.state.sessionId, 'delivery.updated', payload),
  );
  bus.subscribe('delivery.position', (payload) => realtime.toDelivery(payload.sessionId, 'delivery.position', payload));
  // Después de suscribir el tiempo real: los incidentes de la primera corrida también llegan a los mapas.
  const stopNews = news ? news.start() : async () => {};

  return {
    port: (httpServer.address() as AddressInfo).port,
    close: async () => {
      stopTicker();
      // io.close() también cierra el servidor HTTP.
      await realtime.close();
      await stopNews();
      await stopRisk();
    },
  };
}
