import type { Server as HttpServer } from 'node:http';
import { PUBLIC_INCIDENTS_ROOM, type DomainEventName, type DomainEvents, type PublicServerEvents } from '@urbansafe/shared';
import { Server } from 'socket.io';

export type Realtime = {
  toPublicIncidents<K extends DomainEventName>(name: K, payload: DomainEvents[K]): void;
  close(): Promise<void>;
};

export function createRealtime(httpServer: HttpServer): Realtime {
  const io = new Server<Record<string, never>, PublicServerEvents>(httpServer, { serveClient: false });

  io.on('connection', (socket) => {
    void socket.join(PUBLIC_INCIDENTS_ROOM);
  });

  return {
    toPublicIncidents(name, payload) {
      io.to(PUBLIC_INCIDENTS_ROOM).emit(name, ...([payload] as Parameters<PublicServerEvents[typeof name]>));
    },
    close: () => io.close(),
  };
}
