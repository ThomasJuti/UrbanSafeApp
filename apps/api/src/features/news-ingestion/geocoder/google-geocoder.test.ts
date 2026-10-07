import { describe, expect, it } from 'vitest';
import { createCachedGeocoder, type GeocodeCache } from './cached-geocoder';
import type { Geocoder, GeocodeResult } from './geocoder';
import { classifyGeocodeResponse, createGoogleGeocoder, numberedStreetQuery, type GoogleGeocodeResponse } from './google-geocoder';

const BOGOTA = [
  { long_name: 'Bogotá', types: ['locality', 'political'] },
  { long_name: 'Bogotá, D.C.', types: ['administrative_area_level_1', 'political'] },
  { long_name: 'Colombia', types: ['country', 'political'] },
];

type Result = GoogleGeocodeResponse['results'][number];

function result(types: string[], name: string, lat: number, lng: number, span = 0.002): Result {
  return {
    types,
    address_components: [{ long_name: name, types }, ...BOGOTA],
    geometry: {
      location: { lat, lng },
      viewport: { northeast: { lat: lat + span, lng: lng + span }, southwest: { lat: lat - span, lng: lng - span } },
    },
  };
}

const ok = (...results: Result[]): GoogleGeocodeResponse => ({ status: 'OK', results });

describe('classifyGeocodeResponse', () => {
  it('un cruce de calles es un punto', () => {
    const response = ok(result(['intersection'], 'Calle 80 & Avenida Boyacá', 4.6935, -74.0866));
    expect(classifyGeocodeResponse(response)).toEqual({ kind: 'point', point: { lat: 4.6935, lng: -74.0866 } });
  });

  it('un barrio es un área con la caja de Google', () => {
    const response = ok(result(['neighborhood', 'political'], 'Las Ferias', 4.69, -74.09, 0.005));
    expect(classifyGeocodeResponse(response)).toEqual({
      kind: 'neighborhood',
      name: 'Las Ferias',
      point: { lat: 4.69, lng: -74.09 },
      viewport: {
        south: expect.closeTo(4.685),
        west: expect.closeTo(-74.095),
        north: expect.closeTo(4.695),
        east: expect.closeTo(-74.085),
      },
    });
  });

  it('en Bogotá sublocality_level_1 es la localidad', () => {
    const response = ok(result(['political', 'sublocality', 'sublocality_level_1'], 'Engativá', 4.7, -74.11, 0.05));
    expect(classifyGeocodeResponse(response)).toEqual({ kind: 'locality', name: 'Engativá', point: { lat: 4.7, lng: -74.11 } });
  });

  it('rechaza el resultado que es solo la ciudad', () => {
    expect(classifyGeocodeResponse(ok(result(['locality', 'political'], 'Bogotá', 4.711, -74.0721, 0.2)))).toBeNull();
  });

  it('rechaza lo que cae fuera del casco urbano (Sumapaz)', () => {
    expect(classifyGeocodeResponse(ok(result(['neighborhood', 'political'], 'Nazareth', 4.18, -74.17)))).toBeNull();
  });

  it('rechaza un municipio vecino aunque caiga dentro de la caja del casco urbano', () => {
    const soacha: Result = {
      ...result(['street_address'], 'Carrera 7', 4.58, -74.215),
      address_components: [
        { long_name: 'Carrera 7', types: ['route'] },
        { long_name: 'Soacha', types: ['locality', 'political'] },
        { long_name: 'Cundinamarca', types: ['administrative_area_level_1', 'political'] },
      ],
    };
    expect(classifyGeocodeResponse(ok(soacha))).toBeNull();
  });

  it('una vía larga es la vía, no un punto en la mitad; una cuadra sí es un punto', () => {
    expect(classifyGeocodeResponse(ok(result(['route'], 'Avenida Boyacá', 4.65, -74.11, 0.1)))).toEqual({
      kind: 'street',
      name: 'Avenida Boyacá',
      point: { lat: 4.65, lng: -74.11 },
    });
    expect(classifyGeocodeResponse(ok(result(['route'], 'Calle 23 Sur', 4.58, -74.1, 0.001)))).toMatchObject({ kind: 'point' });
  });

  it('una ciclorruta numerada se vuelve a preguntar como calle', () => {
    expect(numberedStreetQuery('Ciclorruta de la 26, Bogotá')).toBe('Calle 26');
    expect(numberedStreetQuery('Carrera 7 con calle 100')).toBe('Carrera 7');
    expect(numberedStreetQuery('Bogotá')).toBeNull();
  });

  it('sin resultados no hay ubicación', () => {
    expect(classifyGeocodeResponse({ status: 'ZERO_RESULTS', results: [] })).toBeNull();
  });
});

function fakeFetch(responses: (GoogleGeocodeResponse | number)[]) {
  const urls: string[] = [];
  const doFetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses.shift();
    if (next === undefined) throw new Error('Sin más respuestas');
    if (typeof next === 'number') return new Response('error', { status: next });
    return Response.json(next);
  }) as typeof fetch;
  return { doFetch, urls };
}

describe('createGoogleGeocoder', () => {
  it('restringe la búsqueda a Bogotá y al casco urbano', async () => {
    const { doFetch, urls } = fakeFetch([{ status: 'ZERO_RESULTS', results: [] }]);
    await createGoogleGeocoder({ apiKey: 'k', fetch: doFetch }).geocode('Parque de los Novios');

    const params = new URL(urls[0] ?? '').searchParams;
    expect(params.get('region')).toBe('co');
    expect(params.get('components')).toBe('locality:Bogotá|country:CO');
    expect(params.get('bounds')).toBe('4.46,-74.23|4.84,-73.99');
  });

  it('reintenta ante 5xx y OVER_QUERY_LIMIT', async () => {
    const { doFetch, urls } = fakeFetch([503, { status: 'OVER_QUERY_LIMIT', results: [] }, ok(result(['premise'], 'X', 4.6, -74.1))]);
    const geocoded = await createGoogleGeocoder({ apiKey: 'k', fetch: doFetch, retryBaseMs: 1 }).geocode('x');

    expect(geocoded).toMatchObject({ kind: 'point' });
    expect(urls).toHaveLength(3);
  });

  it('si Google responde solo la ciudad, reintenta con la vía numerada del texto', async () => {
    const city = ok(result(['locality', 'political'], 'Bogotá', 4.71, -74.07, 0.2));
    const avenue = ok(result(['route'], 'Avenida Calle 26', 4.65, -74.1, 0.1));
    const { doFetch, urls } = fakeFetch([city, avenue]);

    const geocoded = await createGoogleGeocoder({ apiKey: 'k', fetch: doFetch, retryBaseMs: 1 }).geocode('Ciclorruta de la 26');

    expect(geocoded).toMatchObject({ kind: 'street', name: 'Avenida Calle 26' });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1] ?? '').searchParams.get('address')).toBe('Calle 26');
  });

  it('no reintenta una clave rechazada', async () => {
    const { doFetch, urls } = fakeFetch([{ status: 'REQUEST_DENIED', results: [] }]);
    await expect(createGoogleGeocoder({ apiKey: 'k', fetch: doFetch, retryBaseMs: 1 }).geocode('x')).rejects.toThrow(
      'REQUEST_DENIED',
    );
    expect(urls).toHaveLength(1);
  });
});

describe('createCachedGeocoder', () => {
  function memoryCache() {
    const store = new Map<string, GeocodeResult>();
    const cache: GeocodeCache = {
      get: async (key) => (store.has(key) ? { hit: true, result: store.get(key) ?? null } : { hit: false }),
      set: async (key, value) => void store.set(key, value),
    };
    return { cache, store };
  }

  function countingGeocoder(result: GeocodeResult) {
    let calls = 0;
    const geocoder: Geocoder = {
      geocode: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return result;
      },
    };
    return { geocoder, calls: () => calls };
  }

  it('el mismo lugar escrito distinto se pregunta una sola vez, también si no se encontró', async () => {
    const { cache, store } = memoryCache();
    const inner = countingGeocoder(null);
    const geocoder = createCachedGeocoder(inner.geocoder, cache);

    expect(await geocoder.geocode('Barrio Las Ferias, Engativá')).toBeNull();
    expect(await geocoder.geocode('barrio las ferias engativa')).toBeNull();

    expect(inner.calls()).toBe(1);
    expect([...store.keys()]).toEqual(['barrio las ferias engativa']);
  });

  it('dos artículos simultáneos con el mismo lugar comparten la consulta', async () => {
    const inner = countingGeocoder({ kind: 'point', point: { lat: 4.6, lng: -74.1 } });
    const geocoder = createCachedGeocoder(inner.geocoder, memoryCache().cache);

    await Promise.all([geocoder.geocode('Calle 80'), geocoder.geocode('calle 80')]);

    expect(inner.calls()).toBe(1);
  });
});
