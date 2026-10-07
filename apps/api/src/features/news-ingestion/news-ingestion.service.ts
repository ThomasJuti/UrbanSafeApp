import { PARAMS } from '@urbansafe/shared';
import pLimit from 'p-limit';
import type { NewsIngestionConfig } from '../../shared/config';
import type { Db } from '../../shared/db';
import type { GeocodeKind } from '../../shared/db/schema';
import type { EventBus } from '../../shared/events';
import { getMapIncident } from '../incidents';
import { dedupeCandidates, normalizeText, toCandidate, type ArticleCandidate } from './article';
import { createGeminiExtractor } from './extractor/gemini-extractor';
import { throttleExtractor } from './extractor/throttle';
import type { Extraction, NewsExtractor } from './extractor/extractor';
import { createCachedGeocoder } from './geocoder/cached-geocoder';
import type { Geocoder, GeocodeResult } from './geocoder/geocoder';
import { createGoogleGeocoder } from './geocoder/google-geocoder';
import {
  claimArticles,
  createGeocodeCache,
  listLocalities,
  markDiscarded,
  markFailed,
  recordExtraction,
  storeNewsIncident,
  withIngestionLock,
  type ClaimedArticle,
  type ExtractionRecord,
  type NewsIncidentLocation,
} from './news-ingestion.repository';
import { NEWS_SOURCES, type FeedSource } from './news-sources';
import { fetchFeedText, parseRss, type FetchText } from './rss';

// Hacia el LLM y el geocodificador (AGENTS: concurrencia limitada). Cada artículo hace una
// llamada a cada uno, así que esto acota las dos.
const ARTICLE_CONCURRENCY = 4;
const FEED_CONCURRENCY = 4;

type Log = Pick<Console, 'log' | 'warn' | 'error'>;

export type DiscardReason =
  | 'not_relevant'
  | 'outside_bogota'
  | 'no_location'
  | 'too_old'
  | 'not_geocoded'
  | 'locality_unmatched';

export type FeedReport = { id: string; items: number; invalid: number; error: string | null };

export type CollectedFeeds = {
  feeds: FeedReport[];
  candidates: ArticleCandidate[];
  stale: number;
  prefiltered: number;
  invalid: number;
};

export type IngestionSummary = {
  feeds: FeedReport[];
  fetched: number;
  stale: number;
  prefiltered: number;
  invalid: number;
  duplicates: number;
  processed: number;
  created: number;
  merged: number;
  alreadySource: number;
  discarded: Partial<Record<DiscardReason, number>>;
  failed: number;
};

// Descarga y normaliza todos los feeds. Un feed caído no frena a los demás.
export async function collectCandidates(sources: FeedSource[], fetchText: FetchText, now: Date): Promise<CollectedFeeds> {
  const limit = pLimit(FEED_CONCURRENCY);
  const result: CollectedFeeds = { feeds: [], candidates: [], stale: 0, prefiltered: 0, invalid: 0 };

  const parsed = await Promise.all(
    sources.map((source) =>
      limit(async () => {
        try {
          return { source, feed: parseRss(await fetchText(source.url)), error: null };
        } catch (error) {
          return { source, feed: null, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    ),
  );

  for (const { source, feed, error } of parsed) {
    result.feeds.push({ id: source.id, items: feed?.items.length ?? 0, invalid: feed?.invalid ?? 0, error });
    if (!feed) continue;
    result.invalid += feed.invalid;
    for (const item of feed.items) {
      const candidate = toCandidate(item, source, now);
      if (candidate.kind === 'candidate') result.candidates.push(candidate.candidate);
      else result[candidate.reason] += 1;
    }
  }
  result.candidates = dedupeCandidates(result.candidates);
  return result;
}

// Lo que se puede decidir solo con la extracción, antes de gastar una geocodificación.
export function screenExtraction(extraction: Extraction, now: Date): DiscardReason | null {
  if (!extraction.relevant) return 'not_relevant';
  if (!extraction.inBogota) return 'outside_bogota';
  if (!extraction.locationText) return 'no_location';
  if (now.getTime() - extraction.occurredAt.getTime() > PARAMS.newsIngestion.maxArticleAgeMs) return 'too_old';
  return null;
}

export type Locality = { code: string; name: string };

// "Localidad de Los Mártires", "Los Mártires" y "Mártires" son la misma localidad.
export function localityKey(name: string): string {
  return normalizeText(name)
    .replace(/^localidad (de )?/, '')
    .replace(/^(el|la|los|las) /, '');
}

export function matchLocality(name: string, localities: Locality[]): Locality | null {
  const key = localityKey(name);
  return localities.find((locality) => localityKey(locality.name) === key) ?? null;
}

export type Located = { location: NewsIncidentLocation; kind: GeocodeKind } | { discard: DiscardReason };

// Ubicación del incidente según lo que encontró el geocodificador (M1: punto, barrio o localidad).
// Un "barrio" que se llama igual que una localidad se toma como localidad: es la lectura prudente,
// porque una localidad pesa menos y nunca absorbe a otros incidentes (RN-09).
export function locate(geocoded: GeocodeResult, localities: Locality[]): Located {
  if (!geocoded) return { discard: 'not_geocoded' };
  if (geocoded.kind === 'point') {
    return { kind: 'point', location: { kind: 'point', lng: geocoded.point.lng, lat: geocoded.point.lat } };
  }
  const locality = matchLocality(geocoded.name, localities);
  if (locality) return { kind: 'locality', location: { kind: 'locality', code: locality.code, name: locality.name } };
  if (geocoded.kind === 'locality') return { discard: 'locality_unmatched' };

  const { south, west, north, east } = geocoded.viewport;
  return {
    kind: 'neighborhood',
    location: {
      kind: 'neighborhood',
      name: geocoded.name,
      lng: geocoded.point.lng,
      lat: geocoded.point.lat,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    },
  };
}

// Parámetros iniciales: noticias 0,7, por el factor del área si la ubicación es imprecisa.
export function newsConfidence(kind: NewsIncidentLocation['kind']): number {
  const base = PARAMS.initialConfidence.news;
  return kind === 'point' ? base : base * PARAMS.areaConfidenceFactor[kind];
}

type ArticleOutcome =
  | { kind: 'created' | 'merged' | 'duplicate' }
  | { kind: 'discarded'; reason: DiscardReason }
  | { kind: 'failed' };

export type RunLock = <T>(task: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;

export type NewsIngestionDeps = {
  db: Db;
  bus: EventBus;
  extractor: NewsExtractor;
  geocoder: Geocoder;
  sources?: FeedSource[];
  fetchText?: FetchText;
  lock?: RunLock;
  now?: () => Date;
  log?: Log;
};

export type NewsIngestion = ReturnType<typeof createNewsIngestion>;

export function createNewsIngestion(deps: NewsIngestionDeps) {
  const { db, bus, extractor, geocoder } = deps;
  const sources = deps.sources ?? NEWS_SOURCES;
  const fetchText = deps.fetchText ?? fetchFeedText;
  const lock: RunLock = deps.lock ?? ((task) => withIngestionLock(db, task));
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console;

  async function processArticle(article: ClaimedArticle, localities: Locality[]): Promise<ArticleOutcome> {
    try {
      const extraction = await extractor.extract({
        title: article.title,
        summary: article.summary,
        media: article.mediaName,
        publishedAt: article.publishedAt,
      });
      const record: ExtractionRecord = {
        extractedType: extraction.type,
        locationText: extraction.locationText,
        geocodeKind: null,
        occurredAt: extraction.occurredAt,
        timeKnown: extraction.timeKnown,
      };

      const screened = screenExtraction(extraction, now());
      if (screened || !extraction.locationText) {
        const reason = screened ?? 'no_location';
        await markDiscarded(db, article.id, reason, record);
        return { kind: 'discarded', reason };
      }

      const located = locate(await geocoder.geocode(extraction.locationText), localities);
      if ('discard' in located) {
        await markDiscarded(db, article.id, located.discard, { ...record, geocodeKind: 'none' });
        return { kind: 'discarded', reason: located.discard };
      }

      await recordExtraction(db, article.id, { ...record, geocodeKind: located.kind });
      const stored = await storeNewsIncident(db, {
        articleId: article.id,
        // incident_sources.ref: la URL del medio, o el enlace de Google si no se pudo decodificar.
        ref: article.url ?? article.googleLink ?? '',
        type: extraction.type,
        location: located.location,
        occurredAt: extraction.occurredAt,
        timeKnown: extraction.timeKnown,
        confidence: newsConfidence(located.location.kind),
      });
      if (stored.outcome === 'locality_unmatched') return { kind: 'discarded', reason: 'locality_unmatched' };

      // F3.5: `risk` recalcula los tramos cercanos y los mapas reciben el cambio, igual que con reportes.
      if (stored.outcome !== 'duplicate') {
        const incident = await getMapIncident(db, stored.incidentId);
        bus.publish(stored.outcome === 'created' ? 'incident.created' : 'incident.updated', { incident });
      }
      return { kind: stored.outcome };
    } catch (error) {
      log.warn(`No se pudo procesar la noticia ${article.id} (${article.title})`, error);
      await markFailed(db, article.id, error).catch((markError: unknown) => log.error('Falló marcar la noticia', markError));
      return { kind: 'failed' };
    }
  }

  async function ingest(): Promise<IngestionSummary> {
    const collected = await collectCandidates(sources, fetchText, now());
    const claimed = await claimArticles(db, collected.candidates);
    const summary: IngestionSummary = {
      feeds: collected.feeds,
      fetched: collected.feeds.reduce((total, feed) => total + feed.items, 0),
      stale: collected.stale,
      prefiltered: collected.prefiltered,
      invalid: collected.invalid,
      duplicates: collected.candidates.length - claimed.length,
      processed: claimed.length,
      created: 0,
      merged: 0,
      alreadySource: 0,
      discarded: {},
      failed: 0,
    };
    if (claimed.length === 0) return summary;

    const localities = await listLocalities(db);
    const limit = pLimit(ARTICLE_CONCURRENCY);
    const outcomes = await Promise.all(claimed.map((article) => limit(() => processArticle(article, localities))));
    for (const outcome of outcomes) {
      if (outcome.kind === 'discarded') {
        summary.discarded[outcome.reason] = (summary.discarded[outcome.reason] ?? 0) + 1;
      } else if (outcome.kind === 'failed') {
        summary.failed++;
      } else if (outcome.kind === 'duplicate') {
        summary.alreadySource++;
      } else {
        summary[outcome.kind]++;
      }
    }
    return summary;
  }

  let running = false;

  // null si ya había una corrida: en este proceso (la bandera) o en otro (el advisory lock).
  async function runOnce(): Promise<IngestionSummary | null> {
    if (running) return null;
    running = true;
    try {
      const result = await lock(ingest);
      return result.ran ? result.value : null;
    } finally {
      running = false;
    }
  }

  function start() {
    let current: Promise<unknown> = Promise.resolve();
    const tick = () => {
      current = runOnce()
        .then((summary) => {
          if (summary) log.log(`Ingesta de noticias: ${formatSummary(summary)}`);
        })
        .catch((error: unknown) => log.error('Falló la ingesta de noticias', error));
    };
    tick();
    const timer = setInterval(tick, PARAMS.newsIngestion.intervalMs);
    return async () => {
      clearInterval(timer);
      await current;
    };
  }

  return { runOnce, start };
}

export function formatSummary(summary: IngestionSummary): string {
  const discarded = Object.entries(summary.discarded)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  return [
    `${summary.fetched} leídos`,
    `${summary.stale} viejos`,
    `${summary.prefiltered} sin términos de delito`,
    `${summary.duplicates} duplicados`,
    `${summary.processed} procesados`,
    `${summary.created} creados`,
    `${summary.merged} fusionados`,
    `${summary.alreadySource} ya eran fuente`,
    `descartados: ${discarded || 'ninguno'}`,
    `${summary.failed} fallidos`,
  ].join(' · ');
}

// Arma la ingesta con los adaptadores que pide la configuración. Sin claves no hay ingesta, pero
// el servidor arranca igual: se avisa una vez y se sigue.
export function createNewsIngestionFromConfig(deps: {
  db: Db;
  bus: EventBus;
  config: NewsIngestionConfig;
  log?: Log;
}): NewsIngestion | null {
  const log = deps.log ?? console;
  const { config } = deps;
  const missing = [
    !config.geminiApiKey && 'GEMINI_API_KEY',
    !config.geocodingApiKey && 'GOOGLE_GEOCODING_API_KEY',
  ].filter(Boolean);
  if (missing.length > 0 || !config.geminiApiKey || !config.geocodingApiKey) {
    log.warn(`Ingesta de noticias (M1) desactivada: falta ${missing.join(' y ')} en el entorno`);
    return null;
  }

  const extractor = throttleExtractor(
    createGeminiExtractor({ model: config.llmModel, apiKey: config.geminiApiKey }),
    config.llmMaxRequestsPerMinute,
  );
  const geocoder = createCachedGeocoder(createGoogleGeocoder({ apiKey: config.geocodingApiKey }), createGeocodeCache(deps.db));
  return createNewsIngestion({ db: deps.db, bus: deps.bus, extractor, geocoder, log });
}
