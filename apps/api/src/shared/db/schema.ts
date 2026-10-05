import type { IncidentType, ReportOutcome, SourceKind } from '@urbansafe/shared';
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
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CommunityReportsTable {
  id: Generated<string>;
  client_id: string;
  device_id: string;
  incident_id: string;
  outcome: ReportOutcome;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface Database {
  incidents: IncidentsTable;
  incident_sources: IncidentSourcesTable;
  reporters: ReportersTable;
  community_reports: CommunityReportsTable;
}
