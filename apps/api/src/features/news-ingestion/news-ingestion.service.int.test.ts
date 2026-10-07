import { PARAMS, type DomainEventName, type LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import type { EventBus } from '../../shared/events';
import type { ArticleForExtraction, Extraction, NewsExtractor } from './extractor/extractor';
import type { Geocoder, GeocodeResult } from './geocoder/geocoder';
import { claimArticles, storeNewsIncident } from './news-ingestion.repository';
import { createNewsIngestion, type RunLock } from './news-ingestion.service';

// Pipeline completo con extractor y geocodificador falsos sobre PostGIS real. Todo cae en el mar
// cerca de (1,8; 1) y los artículos usan un dominio propio.
const BASE: LatLng = { lat: 1, lng: 1.8 };
const MEDIA_HOST = 'pipeline.urbansafe.test';
const passThroughLock: RunLock = async (task) => ({ ran: true, value: await task() });
const silentLog = { log: () => {}, warn: () => {}, error: () => {} };

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 4, statementTimeoutMs: 15_000 }).db;
});

const north = (point: LatLng, meters: number): LatLng => ({ lat: point.lat + meters / 111_320, lng: point.lng });

type FakeArticle = { slug: string; title: string; extraction: Partial<Extraction>; geocode: GeocodeResult };

function feedXml(run: string, articles: FakeArticle[]): string {
  const published = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
  const items = articles
    .map(
      (a) =>
        `<item><title>${a.title} ${run}</title><link>https://${MEDIA_HOST}/${run}/${a.slug}</link><pubDate>${published}</pubDate><description>Robo en la zona</description></item>`,
    )
    .join('');
  return `<rss><channel>${items}</channel></rss>`;
}

function fakes(articles: FakeArticle[]) {
  // Busca en la lista viva: la prueba agrega artículos entre corridas.
  const find = (title: string) => {
    const match = articles.find((a) => title.startsWith(`${a.title} `));
    if (!match) throw new Error(`Artículo inesperado: ${title}`);
    return match;
  };
  const extracted: string[] = [];
  const extractor: NewsExtractor = {
    extract: async (article: ArticleForExtraction) => {
      extracted.push(article.title);
      const fake = find(article.title);
      return {
        relevant: true,
        inBogota: true,
        type: 'armed_robbery',
        locationText: fake.slug,
        occurredAt: new Date(),
        timeKnown: true,
        ...fake.extraction,
      };
    },
  };
  const geocoder: Geocoder = { geocode: async (text) => articles.find((a) => a.slug === text)?.geocode ?? null };
  return { extractor, geocoder, extracted };
}

function recordingBus() {
  const events: { name: DomainEventName; id: string; confidence: number }[] = [];
  const bus: EventBus = {
    publish: (name, payload) => {
      if ('incident' in payload) events.push({ name, id: payload.incident.id, confidence: payload.incident.confidence });
    },
    subscribe: () => () => {},
  };
  return { bus, events };
}

describe('ingesta de noticias de punta a punta (F3)', () => {
  it('extrae, geocodifica, descarta, guarda y publica; lo ya visto no vuelve al LLM', async () => {
    await withRollback(db, async (trx) => {
      const run = `r${Date.now()}`;
      const articles: FakeArticle[] = [
        { slug: 'punto', title: 'Atraco con cuchillo', extraction: {}, geocode: { kind: 'point', point: BASE } },
        {
          slug: 'barrio',
          title: 'Riña en el barrio',
          extraction: { type: 'fight', timeKnown: false },
          geocode: {
            kind: 'neighborhood',
            name: 'Barrio de prueba',
            point: north(BASE, 20_000),
            viewport: { south: BASE.lat + 0.17, west: BASE.lng - 0.01, north: BASE.lat + 0.19, east: BASE.lng + 0.01 },
          },
        },
        { slug: 'opinion', title: 'Columna sobre la seguridad', extraction: { relevant: false }, geocode: null },
        { slug: 'soacha', title: 'Hurto en Soacha', extraction: { inBogota: false }, geocode: null },
        { slug: 'ningun-lugar', title: 'Robo en algún lado', extraction: {}, geocode: null },
      ];
      const { extractor, geocoder, extracted } = fakes(articles);
      const { bus, events } = recordingBus();
      const sources = [{ id: 'test', url: 'https://example.invalid/rss', kind: 'direct' as const }];
      let xml = feedXml(run, articles);
      const ingestion = createNewsIngestion({
        db: trx,
        bus,
        extractor,
        geocoder,
        sources,
        fetchText: async () => xml,
        lock: passThroughLock,
        log: silentLog,
      });

      const first = await ingestion.runOnce();

      expect(first).toMatchObject({
        fetched: 5,
        duplicates: 0,
        processed: 5,
        created: 2,
        merged: 0,
        failed: 0,
        discarded: { not_relevant: 1, outside_bogota: 1, not_geocoded: 1 },
      });
      expect(events.map((e) => e.name)).toEqual(['incident.created', 'incident.created']);
      const confidences = events.map((e) => e.confidence).sort();
      expect(confidences[0]).toBeCloseTo(PARAMS.initialConfidence.news * PARAMS.areaConfidenceFactor.neighborhood);
      expect(confidences[1]).toBeCloseTo(PARAMS.initialConfidence.news);

      // Segunda corrida: lo mismo más una nota de otro medio sobre el atraco, a 150 m.
      extracted.length = 0;
      const followUp: FakeArticle = { slug: 'mismo-hecho', title: 'Robo a mano armada', extraction: {}, geocode: { kind: 'point', point: north(BASE, 150) } };
      articles.push(followUp);
      xml = feedXml(run, articles);
      const second = await ingestion.runOnce();

      expect(extracted).toEqual([`Robo a mano armada ${run}`]);
      expect(second).toMatchObject({ duplicates: 5, processed: 1, created: 0, merged: 1 });
      expect(events.at(-1)).toMatchObject({ name: 'incident.updated', id: events[0]?.id });
      expect(events.at(-1)?.confidence).toBeCloseTo(PARAMS.initialConfidence.news + PARAMS.confidenceAdjustments.merge);

      const stored = await trx
        .selectFrom('news_articles')
        .select(['title', 'status', 'discard_reason', 'geocode_kind', 'location_text'])
        .where('media_key', '=', MEDIA_HOST)
        .execute();
      expect(stored).toHaveLength(6);
      expect(stored.find((a) => a.title.startsWith('Riña'))).toMatchObject({ status: 'incident', geocode_kind: 'neighborhood', location_text: 'barrio' });
      expect(stored.find((a) => a.title.startsWith('Robo en'))).toMatchObject({ status: 'discarded', discard_reason: 'not_geocoded', geocode_kind: 'none' });
    });
  });
});

// Esto hace commit: dos conexiones a la vez. Usa su propia franja del mar y un medio propio, y lo borra.
const RACE_AREA = { minLng: 1.95, minLat: 0.9, maxLng: 2.05, maxLat: 1.1 };
const RACE_MEDIA = 'race.urbansafe.test';

describe('submit_news_incident con envíos simultáneos', () => {
  afterAll(async () => {
    if (!db) return;
    await db
      .deleteFrom('incidents')
      .where(sql<boolean>`geom && ST_MakeEnvelope(${RACE_AREA.minLng}, ${RACE_AREA.minLat}, ${RACE_AREA.maxLng}, ${RACE_AREA.maxLat}, 4326)`)
      .execute();
    await db.deleteFrom('news_articles').where('media_key', '=', RACE_MEDIA).execute();
    await db.destroy();
  });

  it('dos medios con el mismo hecho a la vez dejan un solo incidente', async () => {
    const point = { lat: 1, lng: 2 };
    const stamp = Date.now();
    const claimed = await claimArticles(
      db,
      [1, 2, 3, 4].map((n) => ({
        url: `https://${RACE_MEDIA}/${stamp}/${n}`,
        googleLink: null,
        normalizedTitle: `atraco ${stamp} ${n}`,
        mediaKey: RACE_MEDIA,
        mediaName: 'Carrera',
        title: `Atraco ${n}`,
        summary: '',
        feed: 'test',
        publishedAt: new Date(),
      })),
    );
    expect(claimed).toHaveLength(4);

    const results = await Promise.all(
      claimed.map((article, i) =>
        storeNewsIncident(db, {
          articleId: article.id,
          ref: article.url ?? '',
          type: i % 2 === 0 ? 'armed_robbery' : 'personal_theft',
          location: { kind: 'point', lng: point.lng, lat: point.lat + i * 0.001 },
          occurredAt: new Date(),
          timeKnown: true,
          confidence: PARAMS.initialConfidence.news,
        }),
      ),
    );

    expect(new Set(results.map((r) => r.incidentId)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'merged')).toHaveLength(3);
    const final = await db
      .selectFrom('incidents')
      .select(['confidence', 'type'])
      .where('id', '=', results[0]?.incidentId ?? '')
      .executeTakeFirstOrThrow();
    expect(final.type).toBe('armed_robbery');
    expect(final.confidence).toBeCloseTo(Math.min(1, PARAMS.initialConfidence.news + 3 * PARAMS.confidenceAdjustments.merge), 5);
  });
});
