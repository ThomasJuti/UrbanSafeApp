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
}

export interface Database {
  incidents: IncidentsTable;
  incident_sources: IncidentSourcesTable;
  reporters: ReportersTable;
  community_reports: CommunityReportsTable;
  incident_votes: IncidentVotesTable;
  road_vertices: RoadVerticesTable;
  road_edges: RoadEdgesTable;
}
