import { MAP_NEWS_LIMIT, newsCitationSchema, PARAMS, type Bbox, type MapIncident, type NewsCitation, type Severity } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

function selectMapIncidents(db: Db) {
  return db
    .selectFrom('incidents')
    .select([
      'id',
      'type',
      'severity',
      'location_kind',
      'location_name',
      'occurred_at',
      'time_known',
      'confidence',
      // No uso el centroide porque en barrios con forma rara puede caer fuera del polígono.
      sql<number>`ST_X(ST_PointOnSurface(geom))`.as('lng'),
      sql<number>`ST_Y(ST_PointOnSurface(geom))`.as('lat'),
    ]);
}

type MapIncidentRow = Awaited<ReturnType<ReturnType<typeof selectMapIncidents>['executeTakeFirstOrThrow']>>;

function toMapIncident(row: MapIncidentRow, news: NewsCitation[]): MapIncident {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity as Severity,
    location:
      row.location_kind === 'point'
        ? { kind: 'point', point: { lat: row.lat, lng: row.lng } }
        : {
            kind: 'area',
            level: row.location_kind,
            name: row.location_name ?? '',
            point: { lat: row.lat, lng: row.lng },
          },
    occurredAt: row.occurred_at.toISOString(),
    timeKnown: row.time_known,
    confidence: row.confidence,
    news,
  };
}

function takeCitation(list: NewsCitation[], citation: NewsCitation | null) {
  if (!citation || list.length >= MAP_NEWS_LIMIT || list.some((item) => item.url === citation.url)) return;
  list.push(citation);
}

function citation(title: string | null, media: string | null, url: string | null): NewsCitation | null {
  const parsed = newsCitationSchema.safeParse({ title: title || null, media: media || null, url });
  return parsed.success ? parsed.data : null;
}

// Primero el artículo (titular y medio). Si no hay fila, la URL guardada en la fuente.
async function newsByIncident(db: Db, ids: string[]): Promise<Map<string, NewsCitation[]>> {
  const byIncident = new Map<string, NewsCitation[]>();
  if (ids.length === 0) return byIncident;

  const articles = await db
    .selectFrom('news_articles')
    .select(['incident_id', 'title', 'media_name', 'url', 'google_link'])
    .where('incident_id', 'in', ids)
    .orderBy('published_at', 'desc')
    .execute();

  for (const article of articles) {
    if (!article.incident_id) continue;
    const list = byIncident.get(article.incident_id) ?? [];
    const before = list.length;
    takeCitation(list, citation(article.title, article.media_name, article.url ?? article.google_link));
    if (list.length > before) byIncident.set(article.incident_id, list);
  }

  const missing = ids.filter((id) => !byIncident.has(id));
  if (missing.length === 0) return byIncident;

  const sources = await db
    .selectFrom('incident_sources')
    .select(['incident_id', 'ref'])
    .where('incident_id', 'in', missing)
    .where('kind', '=', 'news')
    .orderBy('added_at', 'desc')
    .execute();

  for (const source of sources) {
    const list = byIncident.get(source.incident_id) ?? [];
    const before = list.length;
    takeCitation(list, citation(null, null, source.ref));
    if (list.length > before) byIncident.set(source.incident_id, list);
  }

  return byIncident;
}

async function withNews(db: Db, rows: MapIncidentRow[]): Promise<MapIncident[]> {
  const news = await newsByIncident(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toMapIncident(row, news.get(row.id) ?? []));
}

export async function listVisibleInBbox(db: Db, bbox: Bbox, limit: number): Promise<MapIncident[]> {
  const rows = await selectMapIncidents(db)
    .where('confidence', '>=', PARAMS.visibilityThreshold)
    .where('occurred_at', '>=', sql<Date>`now() - make_interval(secs => ${PARAMS.mapWindowMs / 1000})`)
    .where(
      sql<boolean>`geom && ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)`,
    )
    .orderBy('occurred_at', 'desc')
    .limit(limit)
    .execute();
  return withNews(db, rows);
}

export async function getMapIncident(db: Db, id: string): Promise<MapIncident> {
  const row = await selectMapIncidents(db).where('id', '=', id).executeTakeFirstOrThrow();
  const [incident] = await withNews(db, [row]);
  if (!incident) throw new Error('getMapIncident no devolvió el incidente');
  return incident;
}
