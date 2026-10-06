import { getConnInfo } from '@hono/node-server/conninfo';
import { COMMON_ERRORS } from '@urbansafe/shared';
import type { Context, MiddlewareHandler } from 'hono';

export type RateLimiter = { hit(key: string): { allowed: boolean; retryAfterS: number } };

// Ventana fija por clave, en memoria: vale porque el MVP corre una sola instancia del API.
export function createRateLimiter(
  { max, windowMs }: { max: number; windowMs: number },
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = now() + windowMs;

  return {
    hit(key) {
      const at = now();
      // Sin barrido, cada IP que pasó una vez quedaría para siempre en memoria.
      if (at >= nextSweepAt) {
        for (const [candidate, window] of windows) if (window.resetAt <= at) windows.delete(candidate);
        nextSweepAt = at + windowMs;
      }
      let window = windows.get(key);
      if (!window || window.resetAt <= at) {
        window = { count: 0, resetAt: at + windowMs };
        windows.set(key, window);
      }
      window.count++;
      return { allowed: window.count <= max, retryAfterS: Math.ceil((window.resetAt - at) / 1000) };
    },
  };
}

export type ClientKey = (c: Context) => string;

// Detrás de un proxy propio (el de Vite en desarrollo) todo llega desde la IP del proxy. Con
// `trustProxy` se usa la última entrada de X-Forwarded-For, la que agregó ese proxy; las
// anteriores las puede inventar el cliente.
export function clientIp(trustProxy: boolean): ClientKey {
  return (c) => {
    if (trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };
}

export function rateLimit(limiter: RateLimiter, key: ClientKey): MiddlewareHandler {
  return async (c, next) => {
    const { allowed, retryAfterS } = limiter.hit(key(c));
    if (!allowed) {
      c.header('Retry-After', String(retryAfterS));
      return c.json({ error: COMMON_ERRORS.tooManyRequests }, 429);
    }
    await next();
  };
}
