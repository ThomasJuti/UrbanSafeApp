import type { IncidentType, ReportOutcome, SourceKind, Vote } from '@urbansafe/shared';
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type LocationKind = 'point' | 'neighborhood' | 'locality';

export interface IncidentsTable {
  id: Generated<string>;
  type: IncidentType;
  severity: number;
  location_kind: LocationKind;
  location_name: string | null;
  geom: ColumnType<never, unknown, unknown>;
  occurred_at: Timestamp;
  time_known: boolean;
  reported_at: ColumnType<Date, Date | string | undefined, Date | string>;
  confidence: number;
}

export interface IncidentSourcesTable {
  id: Generated<string>;
  incident_id: string;
  kind: SourceKind;
  ref: string;
  added_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface ReportersTable {
  device_id: string;
  nickname: string;
  vote_balance: ColumnType<number, number | undefined, number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface IncidentVotesTable {
  device_id: string;
  incident_id: string;
  vote: Vote;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface CommunityReportsTable {
  id: Generated<string>;
  client_id: string;
  device_id: string;
  incident_id: string;
  outcome: ReportOutcome;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// Los bigint llegan de pg como string.
export interface RoadVerticesTable {
  id: string;
  geom: ColumnType<never, unknown, unknown>;
}

export interface RoadEdgesTable {
  id: Generated<string>;
  osm_way_id: string;
  source: string;
  target: string;
  highway: string;
  name: string | null;
  length_m: number;
  cost_s: number;
  reverse_cost_s: number;
  geom: ColumnType<never, unknown, unknown>;
  locality_code: ColumnType<string | null, string | null | undefined, string | null>;
  recent_risk: ColumnType<number, number | undefined, number>;
  // riesgo(tramo, franja) para cada franja de RN-11.
  risk: ColumnType<number[], number[] | undefined, number[]>;
}

export interface LocalityTimeMultipliersTable {
  locality_code: string;
  band: number;
  multiplier: number;
}

export interface LocalityBaseRiskTable {
  code: string;
  name: string;
  crime_count: number;
  area_km2: number;
  base_risk: number;
  period: string;
  geom: ColumnType<never, unknown, unknown>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export type NewsArticleStatus = 'pending' | 'incident' | 'discarded' | 'failed';
export type NewsOutcome = 'created' | 'merged' | 'duplicate';
export type GeocodeKind = LocationKind | 'none';

export interface NewsArticlesTable {
  id: Generated<string>;
  url: string | null;
  google_link: string | null;
  normalized_title: string;
  media_key: string;
  media_name: string;
  title: string;
  summary: string;
  feed: string;
  published_at: Timestamp;
  status: ColumnType<NewsArticleStatus, NewsArticleStatus | undefined, NewsArticleStatus>;
  discard_reason: string | null;
  outcome: NewsOutcome | null;
  incident_id: string | null;
  attempts: ColumnType<number, number | undefined, number>;
  last_error: string | null;
  extracted_type: string | null;
  location_text: string | null;
  geocode_kind: GeocodeKind | null;
  occurred_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  time_known: boolean | null;
  first_seen_at: ColumnType<Date, Date | string | undefined, never>;
  processed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface GeocodeCacheTable {
  query_key: string;
  result: ColumnType<unknown, string | null, string | null>;
  cached_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface Database {
  incidents: IncidentsTable;
  incident_sources: IncidentSourcesTable;
  reporters: ReportersTable;
  community_reports: CommunityReportsTable;
  incident_votes: IncidentVotesTable;
  road_vertices: RoadVerticesTable;
  road_edges: RoadEdgesTable;
  locality_base_risk: LocalityBaseRiskTable;
  locality_time_multipliers: LocalityTimeMultipliersTable;
  news_articles: NewsArticlesTable;
  geocode_cache: GeocodeCacheTable;
}
