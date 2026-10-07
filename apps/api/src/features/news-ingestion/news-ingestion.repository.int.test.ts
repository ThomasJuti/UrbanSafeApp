import { PARAMS, type IncidentType, type LatLng } from '@urbansafe/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../shared/db';
import { withRollback } from '../../shared/db/testing';
import type { ArticleCandidate } from './article';
import {
  claimArticles,
  createGeocodeCache,
  markFailed,
  storeNewsIncident,
  withIngestionLock,
  type NewsIncidentInput,
  type NewsIncidentLocation,
} from './news-ingestion.repository';

// Todo en el mar cerca de (1,6; 1), lejos de los datos reales y de las otras pruebas.
const BASE: LatLng = { lat: 1, lng: 1.6 };
const MEDIA = 'repo.urbansafe.test';
const { merge } = PARAMS.confidenceAdjustments;
const news = PARAMS.initialConfidence.news;

let db: Db;

beforeAll(() => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Falta TEST_DATABASE_URL en .env para las pruebas de integración');
  db = createDb({ url, poolSize: 4, statementTimeoutMs: 15_000 }).db;
});

afterAll(async () => {
  await db?.destroy();
});

const north = (point: LatLng, meters: number): LatLng => ({ lat: point.lat + meters / 111_320, lng: point.lng });

let seq = 0;
function candidate(overrides: Partial<ArticleCandidate> = {}): ArticleCandidate {
  seq++;
  return {
    url: `https://${MEDIA}/noticia-${seq}-${Date.now()}`,
    googleLink: null,
    normalizedTitle: `noticia ${seq} ${Date.now()}`,
    mediaKey: MEDIA,
    mediaName: 'Medio de prueba',
    title: `Noticia ${seq}`,
    summary: '',
    feed: 'test',
    publishedAt: new Date(),
    ...overrides,
  };
}

async function newArticle(trx: Db, overrides: Partial<ArticleCandidate> = {}) {
  const [claimed] = await claimArticles(trx, [candidate(overrides)]);
  if (!claimed) throw new Error('No se registró el artículo');
  return claimed;
}

function pointAt(p: LatLng): NewsIncidentLocation {
  return { kind: 'point', lng: p.lng, lat: p.lat };
}

async function submit(trx: Db, overrides: Partial<NewsIncidentInput> & { location: NewsIncidentLocation }) {
  const article = await newArticle(trx);
  const stored = await storeNewsIncident(trx, {
    articleId: article.id,
    ref: article.url ?? '',
    type: 'armed_robbery',
    occurredAt: new Date(),
    timeKnown: true,
    confidence: news,
    ...overrides,
  });
  return { ...stored, article };
}

function box(center: LatLng, halfDeg: number) {
  return sql`ST_MakeEnvelope(${center.lng - halfDeg}, ${center.lat - halfDeg}, ${center.lng + halfDeg}, ${center.lat + halfDeg}, 4326)`;
}

async function insertIncident(
  trx: Db,
  values: { type: IncidentType; severity: number; kind: 'point' | 'neighborhood' | 'locality'; at: LatLng; halfDeg?: number; confidence?: number; name?: string },
) {
  const row = await trx
    .insertInto('incidents')
    .values({
      type: values.type,
      severity: values.severity,
      location_kind: values.kind,
      location_name: values.kind === 'point' ? null : (values.name ?? `Prueba ${values.kind}`),
      geom: values.kind === 'point' ? sql`ST_SetSRID(ST_MakePoint(${values.at.lng}, ${values.at.lat}), 4326)` : box(values.at, values.halfDeg ?? 0.01),
      occurred_at: new Date(),
      time_known: true,
      confidence: values.confidence ?? 0.3,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function incident(trx: Db, id: string) {
  return trx.selectFrom('incidents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function sources(trx: Db, id: string) {
  return trx.selectFrom('incident_sources').select(['kind', 'ref']).where('incident_id', '=', id).orderBy('id').execute();
}

describe('claimArticles (RN-09, duplicado exacto antes del LLM)', () => {
  it('un artículo ya visto no se vuelve a procesar, por URL, por enlace de Google o por título y medio', async () => {
    await withRollback(db, async (trx) => {
      const first = candidate({ googleLink: `https://news.google.com/rss/articles/${Date.now()}` });
      expect(await claimArticles(trx, [first])).toHaveLength(1);
      await trx.updateTable('news_articles').set({ status: 'discarded' }).where('url', '=', first.url).execute();

      const sameUrl = candidate({ url: first.url });
      const sameGoogle = candidate({ url: null, googleLink: first.googleLink });
      const sameTitle = candidate({ url: null, googleLink: 'https://news.google.com/rss/articles/otro', normalizedTitle: first.normalizedTitle });
      const fresh = candidate();
      const claimed = await claimArticles(trx, [sameUrl, sameGoogle, sameTitle, fresh]);

      expect(claimed.map((a) => a.url)).toEqual([fresh.url]);
    });
  });

  it(`un artículo que falló se reintenta hasta ${PARAMS.newsIngestion.maxAttempts} veces`, async () => {
    await withRollback(db, async (trx) => {
      const item = candidate();
      const attempts: number[] = [];
      for (let i = 0; i < PARAMS.newsIngestion.maxAttempts + 1; i++) {
        const claimed = await claimArticles(trx, [item]);
        attempts.push(claimed.length);
        for (const article of claimed) await markFailed(trx, article.id, new Error('LLM caído'));
      }
      expect(attempts).toEqual([...Array(PARAMS.newsIngestion.maxAttempts).fill(1), 0]);
    });
  });
});

describe('submit_news_incident (RN-09)', () => {
  it('crea un incidente de noticias y deja el artículo enlazado', async () => {
    await withRollback(db, async (trx) => {
      const stored = await submit(trx, { location: pointAt(BASE), timeKnown: false });

      expect(stored.outcome).toBe('created');
      const row = await incident(trx, stored.incidentId ?? '');
      expect(row).toMatchObject({ type: 'armed_robbery', severity: 5, location_kind: 'point', time_known: false });
      expect(row.confidence).toBeCloseTo(news);
      expect(await sources(trx, row.id)).toEqual([{ kind: 'news', ref: stored.article.url }]);
      const article = await trx.selectFrom('news_articles').selectAll().where('id', '=', stored.article.id).executeTakeFirstOrThrow();
      expect(article).toMatchObject({ status: 'incident', outcome: 'created', incident_id: row.id });
    });
  });

  it('se fusiona con un reporte comunitario cercano: +0,1, conserva fuentes y el tipo más grave', async () => {
    await withRollback(db, async (trx) => {
      const community = await insertIncident(trx, { type: 'personal_theft', severity: 3, kind: 'point', at: BASE });
      await trx.insertInto('incident_sources').values({ incident_id: community, kind: 'community', ref: 'device-1' }).execute();

      const stored = await submit(trx, { location: pointAt(north(BASE, 300)), type: 'armed_robbery' });

      expect(stored).toMatchObject({ outcome: 'merged', incidentId: community });
      const row = await incident(trx, community);
      expect(row).toMatchObject({ type: 'armed_robbery', severity: 5 });
      expect(row.confidence).toBeCloseTo(0.3 + merge);
      expect((await sources(trx, community)).map((s) => s.kind)).toEqual(['community', 'news']);
    });
  });

  it('una noticia menos grave no baja el tipo y la confianza no pasa de 1', async () => {
    await withRollback(db, async (trx) => {
      const existing = await insertIncident(trx, { type: 'homicide', severity: 5, kind: 'point', at: BASE, confidence: 0.95 });

      const stored = await submit(trx, { location: pointAt(BASE), type: 'fight' });

      expect(stored.outcome).toBe('merged');
      const row = await incident(trx, existing);
      expect(row).toMatchObject({ type: 'homicide', severity: 5 });
      expect(row.confidence).toBeCloseTo(1);
    });
  });

  it('fusiona tipos compatibles y no fusiona dos hurtos distintos ni a más de 500 m', async () => {
    await withRollback(db, async (trx) => {
      const fight = await insertIncident(trx, { type: 'fight', severity: 2, kind: 'point', at: BASE });
      const assault = await submit(trx, { location: pointAt(BASE), type: 'assault' });
      expect(assault).toMatchObject({ outcome: 'merged', incidentId: fight });
      expect((await incident(trx, fight)).type).toBe('assault');

      const spot = north(BASE, 5000);
      await insertIncident(trx, { type: 'motorcycle_theft', severity: 5, kind: 'point', at: spot });
      expect((await submit(trx, { location: pointAt(spot), type: 'bicycle_theft' })).outcome).toBe('created');
      expect((await submit(trx, { location: pointAt(north(spot, 700)), type: 'motorcycle_theft' })).outcome).toBe('created');
    });
  });

  it('no fusiona hechos con más de 24 h de diferencia', async () => {
    await withRollback(db, async (trx) => {
      await insertIncident(trx, { type: 'armed_robbery', severity: 5, kind: 'point', at: BASE });
      const occurredAt = new Date(Date.now() - PARAMS.dedup.maxTimeGapMs - 60_000);
      expect((await submit(trx, { location: pointAt(BASE), occurredAt })).outcome).toBe('created');
    });
  });

  it('la misma noticia dos veces no suma: no-op', async () => {
    await withRollback(db, async (trx) => {
      const first = await submit(trx, { location: pointAt(BASE) });
      const article = await newArticle(trx);

      const again = await storeNewsIncident(trx, {
        articleId: article.id,
        ref: first.article.url ?? '',
        type: 'armed_robbery',
        location: pointAt(BASE),
        occurredAt: new Date(),
        timeKnown: true,
        confidence: news,
      });

      expect(again).toEqual({ outcome: 'duplicate', incidentId: first.incidentId });
      expect((await incident(trx, first.incidentId ?? '')).confidence).toBeCloseTo(news);
      expect(await sources(trx, first.incidentId ?? '')).toHaveLength(1);
    });
  });

  it('un barrio contiene a los puntos de adentro, en las dos direcciones', async () => {
    await withRollback(db, async (trx) => {
      const neighborhood = await insertIncident(trx, { type: 'fight', severity: 2, kind: 'neighborhood', at: BASE, halfDeg: 0.01 });
      const inside = north(BASE, 900);
      expect(await submit(trx, { location: pointAt(inside), type: 'homicide' })).toMatchObject({
        outcome: 'merged',
        incidentId: neighborhood,
      });

      const spot = north(BASE, 10_000);
      const point = await insertIncident(trx, { type: 'personal_theft', severity: 3, kind: 'point', at: north(spot, 900) });
      const area: NewsIncidentLocation = {
        kind: 'neighborhood',
        name: 'Barrio de prueba',
        lng: spot.lng,
        lat: spot.lat,
        polygon: {
          type: 'Polygon',
          coordinates: [[[spot.lng - 0.01, spot.lat - 0.01], [spot.lng + 0.01, spot.lat - 0.01], [spot.lng + 0.01, spot.lat + 0.01], [spot.lng - 0.01, spot.lat + 0.01], [spot.lng - 0.01, spot.lat - 0.01]]],
        },
      };
      expect(await submit(trx, { location: area, confidence: news * 0.5 })).toMatchObject({ outcome: 'merged', incidentId: point });
    });
  });

  it('una localidad nunca absorbe por contención, tampoco cuando la que llega es la localidad', async () => {
    await withRollback(db, async (trx) => {
      const code = `T${Date.now()}`;
      const name = `Localidad de prueba ${code}`;
      await sql`
        insert into locality_base_risk (code, name, crime_count, area_km2, base_risk, period, geom)
        values (${code}, ${name}, 1, 1, 0, 'prueba', ST_Multi(${box(BASE, 0.05)}))
      `.execute(trx);
      const existingLocality = await insertIncident(trx, { type: 'assault', severity: 4, kind: 'locality', at: BASE, halfDeg: 0.05 });

      const pointInside = await submit(trx, { location: pointAt(BASE), type: 'fight' });
      expect(pointInside.outcome).toBe('created');
      expect(pointInside.incidentId).not.toBe(existingLocality);

      const locality: NewsIncidentLocation = { kind: 'locality', code, name };
      const localityNews = await submit(trx, { location: locality, type: 'homicide', confidence: news * 0.25 });
      expect(localityNews.outcome).toBe('created');
      expect(localityNews.incidentId).not.toBe(pointInside.incidentId);
      const row = await incident(trx, localityNews.incidentId ?? '');
      expect(row).toMatchObject({ location_kind: 'locality', location_name: name });
      expect(row.confidence).toBeCloseTo(news * 0.25);

      // Otra noticia de la misma localidad y tipo compatible sí es el mismo hecho.
      const sameLocality = await submit(trx, { location: locality, type: 'assault', confidence: news * 0.25 });
      expect(sameLocality).toMatchObject({ outcome: 'merged', incidentId: localityNews.incidentId });
    });
  });

  it('una localidad que no está en el riesgo base descarta el artículo', async () => {
    await withRollback(db, async (trx) => {
      const stored = await submit(trx, { location: { kind: 'locality', code: 'no-existe', name: 'Nada' } });
      expect(stored).toMatchObject({ outcome: 'locality_unmatched', incidentId: null });
      const article = await trx.selectFrom('news_articles').selectAll().where('id', '=', stored.article.id).executeTakeFirstOrThrow();
      expect(article).toMatchObject({ status: 'discarded', discard_reason: 'locality_unmatched' });
    });
  });
});

describe('caché de geocodificación', () => {
  it('guarda también los no encontrados y vence a los 30 días', async () => {
    await withRollback(db, async (trx) => {
      const cache = createGeocodeCache(trx);
      const key = `prueba ${Date.now()}`;

      expect(await cache.get(key)).toEqual({ hit: false });
      await cache.set(key, null);
      expect(await cache.get(key)).toEqual({ hit: true, result: null });

      const result = { kind: 'point' as const, point: { lat: 4.6, lng: -74.1 } };
      await cache.set(key, result);
      expect(await cache.get(key)).toEqual({ hit: true, result });

      const expired = new Date(Date.now() - PARAMS.newsIngestion.geocodeCacheTtlMs - 1000);
      await trx.updateTable('geocode_cache').set({ cached_at: expired }).where('query_key', '=', key).execute();
      expect(await cache.get(key)).toEqual({ hit: false });
    });
  });
});

describe('withIngestionLock', () => {
  it('dos corridas a la vez: solo una entra', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));

    const first = withIngestionLock(db, async () => {
      entered();
      await gate;
      return 'primera';
    });
    await inside;
    const second = await withIngestionLock(db, async () => 'segunda');
    release();

    expect(second).toEqual({ ran: false });
    expect(await first).toEqual({ ran: true, value: 'primera' });
    expect(await withIngestionLock(db, async () => 'después')).toEqual({ ran: true, value: 'después' });
  });
});
