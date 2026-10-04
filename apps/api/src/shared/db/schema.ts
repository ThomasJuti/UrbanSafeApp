import type { IncidentType, SourceKind } from '@urbansafe/shared';
import type { ColumnType, Generated } from 'kysely';

// Refleja db/migrations. Las columnas de geometría se leen y escriben con funciones PostGIS vía `sql`.

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

export interface Database {
  incidents: IncidentsTable;
  incident_sources: IncidentSourcesTable;
}
