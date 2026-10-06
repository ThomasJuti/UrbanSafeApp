import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp, createRateLimiter, rateLimit } from './rate-limit';

const WINDOW_MS = 60_000;

describe('tope por IP', () => {
  it('deja pasar hasta el máximo por clave y la siguiente ventana empieza de cero', () => {
    let clock = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: WINDOW_MS }, () => clock);

    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')].map((hit) => hit.allowed)).toEqual([true, true, false]);
    expect(limiter.hit('b').allowed).toBe(true);
    clock += WINDOW_MS / 2;
    expect(limiter.hit('a').retryAfterS).toBe(WINDOW_MS / 2 / 1000);
    clock += WINDOW_MS / 2;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('responde 429 con Retry-After al pasarse, sin llegar al endpoint', async () => {
    let reached = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: WINDOW_MS });
    const app = new Hono().post('/x', rateLimit(limiter, () => 'ip'), (c) => {
      reached++;
      return c.json({ ok: true });
    });

    const first = await app.request('/x', { method: 'POST' });
    const second = await app.request('/x', { method: 'POST' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe(String(WINDOW_MS / 1000));
    expect(await second.json()).toEqual({ error: 'too_many_requests' });
    expect(reached).toBe(1);
  });

  it('detrás del proxy toma la última IP de X-Forwarded-For, no la que inventa el cliente', async () => {
    const app = new Hono().get('/ip', (c) => c.text(clientIp(true)(c)));
    const response = await app.request('/ip', { headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.7' } });
    expect(await response.text()).toBe('10.0.0.7');
  });

  it('sin confiar en el proxy ignora X-Forwarded-For', async () => {
    const app = new Hono().get('/ip', (c) => c.text(clientIp(false)(c)));
    const response = await app.request('/ip', { headers: { 'x-forwarded-for': '6.6.6.6' } });
    expect(await response.text()).not.toBe('6.6.6.6');
  });
});
