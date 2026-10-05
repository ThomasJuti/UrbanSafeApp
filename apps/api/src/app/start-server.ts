import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { RoutingConfig } from '../shared/config';
import type { Db } from '../shared/db';
import { createEventBus } from '../shared/events';
import { createRealtime } from '../shared/realtime';
import { createApp } from './create-app';

export async function startServer(deps: { db: Db; port: number; routing: RoutingConfig }) {
  const bus = createEventBus();
  const app = createApp({ db: deps.db, bus, routing: deps.routing });

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const server = serve({ fetch: app.fetch, port: deps.port }, () => resolve(server as HttpServer));
  });

  const realtime = createRealtime(httpServer);
  bus.subscribe('incident.created', (payload) => realtime.toPublicIncidents('incident.created', payload));
  bus.subscribe('incident.updated', (payload) => realtime.toPublicIncidents('incident.updated', payload));

  return {
    port: (httpServer.address() as AddressInfo).port,
    // io.close() también cierra el servidor HTTP.
    close: () => realtime.close(),
  };
}
