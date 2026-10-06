import type { Server as HttpServer } from 'node:http';
import {
  deliveryRoom,
  PUBLIC_INCIDENTS_ROOM,
  type ClientEvents,
  type DeliveryServerEvents,
  type PublicServerEvents,
  type ServerEvents,
} from '@urbansafe/shared';
import { Server } from 'socket.io';

export type Realtime = {
  toPublicIncidents<K extends keyof PublicServerEvents>(name: K, payload: Parameters<PublicServerEvents[K]>[0]): void;
  toDelivery<K extends keyof DeliveryServerEvents>(
    sessionId: string,
    name: K,
    payload: Parameters<DeliveryServerEvents[K]>[0],
  ): void;
  close(): Promise<void>;
};

export function createRealtime(httpServer: HttpServer, options: { canJoinDelivery(sessionId: string): boolean }): Realtime {
  const io = new Server<ClientEvents, ServerEvents>(httpServer, { serveClient: false });

  io.on('connection', (socket) => {
    void socket.join(PUBLIC_INCIDENTS_ROOM);
    socket.on('delivery.join', ({ sessionId }, ack) => {
      const joined = typeof sessionId === 'string' && options.canJoinDelivery(sessionId);
      if (joined) void socket.join(deliveryRoom(sessionId));
      if (typeof ack === 'function') ack(joined);
    });
  });

  return {
    toPublicIncidents(name, payload) {
      io.to(PUBLIC_INCIDENTS_ROOM).emit(name, ...([payload] as Parameters<ServerEvents[typeof name]>));
    },
    toDelivery(sessionId, name, payload) {
      io.to(deliveryRoom(sessionId)).emit(name, ...([payload] as Parameters<ServerEvents[typeof name]>));
    },
    close: () => io.close(),
  };
}
