import { haversineM, isInsideUrbanArea, PARAMS } from '@urbansafe/shared';
import { z } from 'zod';
import { normalizeText } from '../article';
import { isRetryableStatus, TransientError, withRetry } from '../retry';
import type { Geocoder, GeocodeResult } from './geocoder';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT_MS = 10_000;
const RETRIES = 3;
const RETRY_BASE_MS = 1000;
// Una vía completa ("Avenida Boyacá") viene como `route` con un punto en la mitad de 30 km de
// calle. Solo se acepta como punto si su caja es corta; si no, no dice dónde fue el hecho.
const MAX_ROUTE_VIEWPORT_M = 1000;

const latLng = z.object({ lat: z.number(), lng: z.number() });

export const googleGeocodeResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z
    .array(
      z.object({
        types: z.array(z.string()),
        formatted_address: z.string().optional(),
        address_components: z.array(z.object({ long_name: z.string(), types: z.array(z.string()) })),
        geometry: z.object({
          location: latLng,
          viewport: z.object({ northeast: latLng, southwest: latLng }),
        }),
      }),
    )
    .default([]),
});
export type GoogleGeocodeResponse = z.infer<typeof googleGeocodeResponseSchema>;

const POINT_TYPES = new Set([
  'street_address',
  'intersection',
  'premise',
  'subpremise',
  'point_of_interest',
  'establishment',
  'transit_station',
  'bus_station',
  'park',
  'route',
]);
// En Bogotá, Google llama sublocality_level_1 a las localidades y neighborhood a los barrios.
const LOCALITY_TYPES = new Set(['sublocality_level_1']);
const NEIGHBORHOOD_TYPES = new Set(['neighborhood', 'sublocality', 'sublocality_level_2', 'sublocality_level_3', 'colloquial_area']);

const hasAny = (types: string[], set: Set<string>) => types.some((type) => set.has(type));

// El casco urbano es una caja y alcanza a tocar Soacha, Funza y Chía: se exige que Google diga Bogotá.
const CITY_COMPONENT_TYPES = new Set(['locality', 'administrative_area_level_1']);
const CITY_NAMES = new Set(['bogota', 'bogota d c']);

function isInBogota(components: GoogleGeocodeResponse['results'][number]['address_components']): boolean {
  return components.some((c) => hasAny(c.types, CITY_COMPONENT_TYPES) && CITY_NAMES.has(normalizeText(c.long_name)));
}

// Clasifica el primer resultado. Lo que cae fuera del casco urbano o es solo "Bogotá" (types
// locality / administrative_area_*) se rechaza: no sirve para ubicar un hecho.
export function classifyGeocodeResponse(response: GoogleGeocodeResponse): GeocodeResult {
  const result = response.results[0];
  if (!result) return null;
  const point = result.geometry.location;
  if (!isInsideUrbanArea(point) || !isInBogota(result.address_components)) return null;

  const { northeast, southwest } = result.geometry.viewport;
  const name = result.address_components[0]?.long_name ?? '';

  if (hasAny(result.types, POINT_TYPES)) {
    if (result.types.includes('route')) {
      const diagonal = haversineM([southwest.lng, southwest.lat], [northeast.lng, northeast.lat]);
      if (diagonal > MAX_ROUTE_VIEWPORT_M) return null;
    }
    return { kind: 'point', point };
  }
  if (hasAny(result.types, LOCALITY_TYPES) && name) return { kind: 'locality', name, point };
  if (hasAny(result.types, NEIGHBORHOOD_TYPES) && name) {
    return {
      kind: 'neighborhood',
      name,
      point,
      viewport: { south: southwest.lat, west: southwest.lng, north: northeast.lat, east: northeast.lng },
    };
  }
  return null;
}

export function createGoogleGeocoder(options: { apiKey: string; fetch?: typeof fetch; retryBaseMs?: number }): Geocoder {
  const doFetch = options.fetch ?? fetch;
  const box = PARAMS.urbanBbox;

  return {
    geocode: (locationText) =>
      withRetry(
        async () => {
          const params = new URLSearchParams({
            address: locationText,
            region: 'co',
            language: 'es',
            components: 'locality:Bogotá|country:CO',
            bounds: `${box.minLat},${box.minLng}|${box.maxLat},${box.maxLng}`,
            key: options.apiKey,
          });
          const response = await doFetch(`${GEOCODE_URL}?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
          if (!response.ok) {
            const message = `Google Geocoding respondió ${response.status}`;
            throw isRetryableStatus(response.status) ? new TransientError(message) : new Error(message);
          }
          const body = googleGeocodeResponseSchema.parse(await response.json());
          if (body.status === 'ZERO_RESULTS') return null;
          if (body.status === 'OVER_QUERY_LIMIT' || body.status === 'UNKNOWN_ERROR') {
            throw new TransientError(`Google Geocoding: ${body.status}`);
          }
          // REQUEST_DENIED o INVALID_REQUEST: la clave o el pedido están mal; reintentar no ayuda.
          if (body.status !== 'OK') throw new Error(`Google Geocoding: ${body.status} ${body.error_message ?? ''}`.trim());
          return classifyGeocodeResponse(body);
        },
        { retries: RETRIES, baseDelayMs: options.retryBaseMs ?? RETRY_BASE_MS },
      ),
  };
}
