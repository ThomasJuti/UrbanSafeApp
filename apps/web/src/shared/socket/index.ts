import type { PublicServerEvents } from '@urbansafe/shared';
import { io, type Socket } from 'socket.io-client';

let socket: Socket<PublicServerEvents> | null = null;

// Una sola conexión por pestaña, compartida por todas las features.
export function getSocket(): Socket<PublicServerEvents> {
  socket ??= io({ transports: ['websocket'] });
  return socket;
}
