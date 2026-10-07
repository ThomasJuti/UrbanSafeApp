import { normalizeText } from '../article';
import type { Geocoder, GeocodeResult } from './geocoder';

export type GeocodeCache = {
  get(key: string): Promise<{ hit: true; result: GeocodeResult } | { hit: false }>;
  set(key: string, result: GeocodeResult): Promise<void>;
};

export function geocodeCacheKey(locationText: string): string {
  return normalizeText(locationText);
}

// AGENTS: caché por texto de ubicación normalizado. También guarda los "no encontrado", que son la
// mayoría de las repeticiones (los medios repiten "sur de Bogotá", "una localidad del norte"…).
// Dentro de una corrida, dos artículos con el mismo lugar esperan la misma consulta.
export function createCachedGeocoder(inner: Geocoder, cache: GeocodeCache): Geocoder {
  const inFlight = new Map<string, Promise<GeocodeResult>>();

  async function lookup(key: string, locationText: string): Promise<GeocodeResult> {
    const cached = await cache.get(key);
    if (cached.hit) return cached.result;
    const result = await inner.geocode(locationText);
    await cache.set(key, result);
    return result;
  }

  return {
    geocode(locationText) {
      const key = geocodeCacheKey(locationText);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const promise = lookup(key, locationText).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}
