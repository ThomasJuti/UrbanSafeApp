import { describe, expect, it } from 'vitest';
import { createTtlCache } from './route-cache';

describe('caché de rutas', () => {
  it('devuelve lo guardado y lo olvida al invalidar o al vencer el plazo', () => {
    let clock = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 2, now: () => clock });
    cache.set('a', 'ruta-a');
    expect(cache.get('a')).toBe('ruta-a');

    clock += 101;
    expect(cache.get('a')).toBeUndefined();

    cache.set('a', 'ruta-a');
    cache.set('b', 'ruta-b');
    cache.set('c', 'ruta-c');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe('ruta-c');

    cache.clear();
    expect(cache.get('c')).toBeUndefined();
  });
});
