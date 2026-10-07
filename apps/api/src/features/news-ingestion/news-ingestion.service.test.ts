import { PARAMS } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import type { Extraction, NewsExtractor } from './extractor/extractor';
import type { Geocoder } from './geocoder/geocoder';
import {
  createNewsIngestion,
  createNewsIngestionFromConfig,
  locate,
  matchLocality,
  newsConfidence,
  screenExtraction,
  type RunLock,
} from './news-ingestion.service';

const NOW = new Date('2026-10-06T20:00:00Z');
const LOCALITIES = [
  { code: '10', name: 'Engativá' },
  { code: '14', name: 'Los Mártires' },
  { code: '17', name: 'Candelaria' },
];

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    relevant: true,
    inBogota: true,
    type: 'armed_robbery',
    locationText: 'Calle 80 con Boyacá',
    occurredAt: new Date('2026-10-06T02:00:00Z'),
    timeKnown: true,
    ...overrides,
  };
}

describe('screenExtraction (M1: descartar irrelevantes, fuera de Bogotá o sin ubicación)', () => {
  it('deja pasar un delito concreto en Bogotá con lugar', () => {
    expect(screenExtraction(extraction(), NOW)).toBeNull();
  });

  it.each([
    [{ relevant: false }, 'not_relevant'],
    [{ inBogota: false }, 'outside_bogota'],
    [{ locationText: null }, 'no_location'],
    [{ occurredAt: new Date(NOW.getTime() - PARAMS.newsIngestion.maxArticleAgeMs - 1) }, 'too_old'],
  ] as const)('%o se descarta por %s', (overrides, reason) => {
    expect(screenExtraction(extraction(overrides), NOW)).toBe(reason);
  });
});

describe('locate', () => {
  const point = { lat: 4.69, lng: -74.09 };

  it('una localidad se toma con su código, aunque Google la escriba distinto', () => {
    expect(matchLocality('Localidad de Los Mártires', LOCALITIES)?.code).toBe('14');
    expect(matchLocality('La Candelaria', LOCALITIES)?.code).toBe('17');
    expect(matchLocality('Engativa', LOCALITIES)?.code).toBe('10');
    expect(matchLocality('Soacha', LOCALITIES)).toBeNull();
  });

  it('un barrio queda como polígono de la caja de Google', () => {
    const located = locate(
      { kind: 'neighborhood', name: 'Las Ferias', point, viewport: { south: 4.68, west: -74.1, north: 4.7, east: -74.08 } },
      LOCALITIES,
    );
    expect(located).toMatchObject({ kind: 'neighborhood', location: { kind: 'neighborhood', name: 'Las Ferias' } });
    if ('discard' in located || located.location.kind !== 'neighborhood') throw new Error('Se esperaba un barrio');
    expect(located.location.polygon.coordinates[0]).toHaveLength(5);
  });

  it('un barrio que se llama como una localidad se trata como localidad', () => {
    const located = locate(
      { kind: 'neighborhood', name: 'Engativá', point, viewport: { south: 4.68, west: -74.1, north: 4.7, east: -74.08 } },
      LOCALITIES,
    );
    expect(located).toEqual({ kind: 'locality', location: { kind: 'locality', code: '10', name: 'Engativá' } });
  });

  it('descarta lo que no se geocodificó y la localidad que no existe en el riesgo base', () => {
    expect(locate(null, LOCALITIES)).toEqual({ discard: 'not_geocoded' });
    expect(locate({ kind: 'locality', name: 'Sibaté', point }, LOCALITIES)).toEqual({ discard: 'locality_unmatched' });
  });
});

describe('newsConfidence (Parámetros iniciales)', () => {
  it('parte de 0,7 y reduce por el nivel del área', () => {
    expect(newsConfidence('point')).toBeCloseTo(0.7);
    expect(newsConfidence('neighborhood')).toBeCloseTo(0.35);
    expect(newsConfidence('locality')).toBeCloseTo(0.175);
  });
});

describe('runOnce', () => {
  const unusedExtractor: NewsExtractor = { extract: () => Promise.reject(new Error('no debía llamarse')) };
  const unusedGeocoder: Geocoder = { geocode: () => Promise.reject(new Error('no debía llamarse')) };
  const silentBus: EventBus = { publish: () => {}, subscribe: () => () => {} };
  const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
  const passThroughLock: RunLock = async (task) => ({ ran: true, value: await task() });

  it('nunca solapa dos corridas en el mismo proceso', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let fetches = 0;
    const ingestion = createNewsIngestion({
      // Sin artículos la corrida no toca la base.
      db: {} as Db,
      bus: silentBus,
      extractor: unusedExtractor,
      geocoder: unusedGeocoder,
      sources: [{ id: 'f', url: 'https://example.com/rss', kind: 'direct' }],
      fetchText: async () => {
        fetches++;
        await gate;
        return '<rss><channel></channel></rss>';
      },
      lock: passThroughLock,
      log: silentLog,
    });

    const first = ingestion.runOnce();
    const second = await ingestion.runOnce();
    release();

    expect(second).toBeNull();
    expect(await first).toMatchObject({ fetched: 0, processed: 0 });
    expect(fetches).toBe(1);
  });

  it('no corre si otro proceso tiene el lock', async () => {
    let fetches = 0;
    const ingestion = createNewsIngestion({
      db: {} as Db,
      bus: silentBus,
      extractor: unusedExtractor,
      geocoder: unusedGeocoder,
      fetchText: async () => {
        fetches++;
        return '';
      },
      lock: async () => ({ ran: false }),
      log: silentLog,
    });

    expect(await ingestion.runOnce()).toBeNull();
    expect(fetches).toBe(0);
  });
});

describe('createNewsIngestionFromConfig', () => {
  it('sin claves no arma la ingesta y avisa una vez qué falta', () => {
    const warnings: string[] = [];
    const log = { log: () => {}, error: () => {}, warn: (message: string) => void warnings.push(message) };
    const bus: EventBus = { publish: () => {}, subscribe: () => () => {} };

    const ingestion = createNewsIngestionFromConfig({
      db: {} as Db,
      bus,
      config: { llmProvider: 'gemini', llmModel: 'm', llmMaxRequestsPerMinute: 15, geminiApiKey: null, geocodingApiKey: 'g' },
      log,
    });

    expect(ingestion).toBeNull();
    expect(warnings).toEqual(['Ingesta de noticias (M1) desactivada: falta GEMINI_API_KEY en el entorno']);
  });
});
