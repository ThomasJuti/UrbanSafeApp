import type { ClientEvents, ServerEvents } from '@urbansafe/shared';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerEvents, ClientEvents>;

let socket: AppSocket | null = null;

// Una sola conexión por pestaña, compartida por todas las features. Los eventos de entrega solo
// llegan si la pestaña se une a la sala de su sesión (RN-03).
export function getSocket(): AppSocket {
  socket ??= io({ transports: ['websocket'] });
  return socket;
}
