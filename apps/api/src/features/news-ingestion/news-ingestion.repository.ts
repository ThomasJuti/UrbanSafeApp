import { compatibleTypes, PARAMS, severityOf, type IncidentType } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';
import type { GeocodeKind, NewsOutcome } from '../../shared/db/schema';
import type { ArticleCandidate } from './article';
import type { GeocodeCache } from './geocoder/cached-geocoder';
import { geocodeResultSchema } from './geocoder/geocoder';

export type ClaimedArticle = {
  id: string;
  url: string | null;
  googleLink: string | null;
  title: string;
  summary: string;
  mediaName: string;
  publishedAt: Date;
};

// RN-09 antes del LLM: registra los artículos nuevos y devuelve los que hay que procesar, es decir
// los recién vistos y los que una corrida anterior dejó pendientes o fallidos. Todo lo demás ya se
// procesó y se salta. Dos sentencias, sin importar cuántos artículos traiga la corrida.
export async function claimArticles(db: Db, candidates: ArticleCandidate[]): Promise<ClaimedArticle[]> {
  if (candidates.length === 0) return [];

  await db
    .insertInto('news_articles')
    .values(
      candidates.map((c) => ({
        url: c.url,
        google_link: c.googleLink,
        normalized_title: c.normalizedTitle,
        media_key: c.mediaKey,
        media_name: c.mediaName,
        title: c.title,
        summary: c.summary,
        feed: c.feed,
        published_at: c.publishedAt,
      })),
    )
    // Sin columna de conflicto: cualquiera de las tres llaves de RN-09 marca un duplicado.
    .onConflict((oc) => oc.doNothing())
    .execute();

  const keys = sql.join(
    candidates.map((c) => sql`(${c.url}::text, ${c.googleLink}::text, ${c.normalizedTitle}::text, ${c.mediaKey}::text)`),
  );
  const { rows } = await sql<{
    id: string;
    url: string | null;
    google_link: string | null;
    title: string;
    summary: string;
    media_name: string;
    published_at: Date;
  }>`
    update news_articles a
    set attempts = a.attempts + 1, status = 'pending'
    where a.status in ('pending', 'failed')
      and a.attempts < ${PARAMS.newsIngestion.maxAttempts}
      and exists (
        select 1 from (values ${keys}) as c (url, google_link, normalized_title, media_key)
        where a.url = c.url
          or a.google_link = c.google_link
          or (a.normalized_title = c.normalized_title and a.media_key = c.media_key)
      )
    returning a.id, a.url, a.google_link, a.title, a.summary, a.media_name, a.published_at
  `.execute(db);

  return rows.map((row) => ({
    id: String(row.id),
    url: row.url,
    googleLink: row.google_link,
    title: row.title,
    summary: row.summary,
    mediaName: row.media_name,
    publishedAt: row.published_at,
  }));
}

// La misma historia ya tiene un representante que sí se lee. Estas copias quedan vistas para
// que la corrida siguiente no las mande al LLM.
export async function recordDiscardedCandidates(db: Db, candidates: ArticleCandidate[], reason: string): Promise<void> {
  if (candidates.length === 0) return;
  await db
    .insertInto('news_articles')
    .values(
      candidates.map((candidate) => ({
        url: candidate.url,
        google_link: candidate.googleLink,
        normalized_title: candidate.normalizedTitle,
        media_key: candidate.mediaKey,
        media_name: candidate.mediaName,
        title: candidate.title,
        summary: candidate.summary,
        feed: candidate.feed,
        published_at: candidate.publishedAt,
        status: 'discarded' as const,
        discard_reason: reason,
        processed_at: new Date(),
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export type ExtractionRecord = {
  extractedType: IncidentType | null;
  locationText: string | null;
  geocodeKind: GeocodeKind | null;
  occurredAt: Date | null;
  timeKnown: boolean | null;
};

export async function recordExtraction(db: Db, id: string, record: ExtractionRecord): Promise<void> {
  await db
    .updateTable('news_articles')
    .set({
      extracted_type: record.extractedType,
      location_text: record.locationText,
      geocode_kind: record.geocodeKind,
      occurred_at: record.occurredAt,
      time_known: record.timeKnown,
    })
    .where('id', '=', id)
    .execute();
}

export async function markDiscarded(db: Db, id: string, reason: string, record: ExtractionRecord): Promise<void> {
  await db
    .updateTable('news_articles')
    .set({
      status: 'discarded',
      discard_reason: reason,
      processed_at: new Date(),
      extracted_type: record.extractedType,
      location_text: record.locationText,
      geocode_kind: record.geocodeKind,
      occurred_at: record.occurredAt,
      time_known: record.timeKnown,
    })
    .where('id', '=', id)
    .execute();
}

const MAX_ERROR_CHARS = 500;

export async function markFailed(db: Db, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await db
    .updateTable('news_articles')
    .set({ status: 'failed', last_error: message.slice(0, MAX_ERROR_CHARS) })
    .where('id', '=', id)
    .execute();
}

export type NewsIncidentLocation =
  | { kind: 'point'; lng: number; lat: number }
  | { kind: 'neighborhood'; name: string; lng: number; lat: number; polygon: GeoJsonPolygon }
  | { kind: 'locality'; code: string; name: string }
  | { kind: 'street'; name: string; lng: number; lat: number };

export type GeoJsonPolygon = { type: 'Polygon'; coordinates: [number, number][][] };

export type NewsIncidentInput = {
  articleId: string;
  ref: string;
  type: IncidentType;
  location: NewsIncidentLocation;
  occurredAt: Date;
  timeKnown: boolean;
  confidence: number;
};

export type StoredNewsIncident =
  | { outcome: NewsOutcome; incidentId: string }
  | { outcome: 'locality_unmatched' | 'street_unmatched'; incidentId: null };

// Deduplicación (RN-09), fusión y registro del artículo en una sola transacción (ver la migración).
export async function storeNewsIncident(db: Db, input: NewsIncidentInput): Promise<StoredNewsIncident> {
  const { merge, max } = PARAMS.confidenceAdjustments;
  const loc = input.location;
  const point = loc.kind === 'locality' ? null : loc;
  const { rows } = await sql<{ r_outcome: StoredNewsIncident['outcome']; r_incident_id: string | null }>`
    select * from submit_news_incident(
      ${input.articleId}::bigint,
      ${input.ref},
      ${input.type},
      ${severityOf(input.type)}::smallint,
      ${loc.kind},
      ${loc.kind === 'point' ? null : loc.name}::text,
      ${point?.lng ?? null}::float8,
      ${point?.lat ?? null}::float8,
      ${loc.kind === 'neighborhood' ? JSON.stringify(loc.polygon) : null}::text,
      ${loc.kind === 'locality' ? loc.code : null}::text,
      ${input.occurredAt}::timestamptz,
      ${input.timeKnown},
      ${input.confidence}::real,
      ${compatibleTypes(input.type)}::text[],
      ${PARAMS.dedup.maxDistanceM}::float8,
      ${PARAMS.dedup.maxTimeGapMs / 1000}::float8,
      ${merge}::real,
      ${max}::real,
      ${PARAMS.newsIngestion.streetBufferM}::float8,
      ${PARAMS.newsIngestion.streetSnapM}::float8
    )`.execute(db);

  const row = rows[0];
  if (!row) throw new Error('submit_news_incident no devolvió fila');
  if (row.r_outcome === 'locality_unmatched' || row.r_outcome === 'street_unmatched' || !row.r_incident_id) {
    if (row.r_outcome === 'street_unmatched') return { outcome: 'street_unmatched', incidentId: null };
    return { outcome: 'locality_unmatched', incidentId: null };
  }
  return { outcome: row.r_outcome, incidentId: row.r_incident_id };
}

export async function listLocalities(db: Db): Promise<{ code: string; name: string }[]> {
  return db.selectFrom('locality_base_risk').select(['code', 'name']).execute();
}

export function createGeocodeCache(db: Db): GeocodeCache {
  return {
    async get(key) {
      const row = await db
        .selectFrom('geocode_cache')
        .select('result')
        .where('query_key', '=', key)
        .where('cached_at', '>', sql<Date>`now() - make_interval(secs => ${PARAMS.newsIngestion.geocodeCacheTtlMs / 1000})`)
        .executeTakeFirst();
      if (!row) return { hit: false };
      // Si el formato guardado cambió, se trata como ausente y se vuelve a preguntar.
      const parsed = geocodeResultSchema.safeParse(row.result);
      return parsed.success ? { hit: true, result: parsed.data } : { hit: false };
    },
    async set(key, result) {
      const value = result === null ? null : JSON.stringify(result);
      await db
        .insertInto('geocode_cache')
        .values({ query_key: key, result: value })
        .onConflict((oc) => oc.column('query_key').doUpdateSet({ result: value, cached_at: sql`now()` }))
        .execute();
    },
  };
}

export type ProcessedArticleRow = {
  processedAt: Date;
  title: string;
  mediaName: string;
  link: string;
  extractedType: string | null;
  locationText: string | null;
  geocodeKind: string | null;
  status: string;
  outcome: string | null;
  discardReason: string | null;
  incidentId: string | null;
};

// §7: muestra para revisar a mano la calidad de la extracción y de la deduplicación.
export async function listProcessedArticles(db: Db, limit: number): Promise<ProcessedArticleRow[]> {
  const rows = await db
    .selectFrom('news_articles')
    .select([
      'processed_at',
      'title',
      'media_name',
      'url',
      'google_link',
      'extracted_type',
      'location_text',
      'geocode_kind',
      'status',
      'outcome',
      'discard_reason',
      'incident_id',
    ])
    .where('processed_at', 'is not', null)
    .orderBy('processed_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => ({
    processedAt: row.processed_at ?? new Date(0),
    title: row.title,
    mediaName: row.media_name,
    link: row.url ?? row.google_link ?? '',
    extractedType: row.extracted_type,
    locationText: row.location_text,
    geocodeKind: row.geocode_kind,
    status: row.status,
    outcome: row.outcome,
    discardReason: row.discard_reason,
    incidentId: row.incident_id,
  }));
}

const INGESTION_LOCK = 'urbansafe:news-ingestion';

// Nunca dos corridas a la vez, ni siquiera entre el servidor y `pnpm ingest:news`: el lock es de
// sesión y vive en una conexión apartada mientras dura la corrida.
export async function withIngestionLock<T>(db: Db, task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`select pg_try_advisory_lock(hashtext(${INGESTION_LOCK})) as locked`.execute(conn);
    if (!rows[0]?.locked) return { ran: false as const };
    try {
      return { ran: true as const, value: await task() };
    } finally {
      await sql`select pg_advisory_unlock(hashtext(${INGESTION_LOCK}))`.execute(conn);
    }
  });
}
