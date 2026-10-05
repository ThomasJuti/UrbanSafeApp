import { compatibleTypes, PARAMS, severityOf, type CreateReportBody, type ReportOutcome } from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

type Row = { r_outcome: ReportOutcome | 'rate_limited'; r_incident_id: string | null; r_replayed: boolean };

export type StoredReport =
  | { kind: 'accepted'; outcome: ReportOutcome; incidentId: string; replayed: boolean }
  | { kind: 'rate_limited' };

export async function storeCommunityReport(db: Db, report: CreateReportBody): Promise<StoredReport> {
  const { confirm, max } = PARAMS.confidenceAdjustments;
  const { rows } = await sql<Row>`
    select * from submit_community_report(
      ${report.clientId}::uuid,
      ${report.deviceId}::uuid,
      ${report.nickname},
      ${report.type},
      ${severityOf(report.type)}::smallint,
      ${report.point.lng}::float8,
      ${report.point.lat}::float8,
      ${compatibleTypes(report.type)}::text[],
      ${PARAMS.dedup.maxDistanceM}::float8,
      ${PARAMS.dedup.maxTimeGapMs / 1000}::float8,
      ${PARAMS.reportRateLimit.max}::int,
      ${PARAMS.reportRateLimit.windowMs / 1000}::float8,
      ${PARAMS.initialConfidence.community}::real,
      ${confirm}::real,
      ${max}::real
    )`.execute(db);

  const row = rows[0];
  if (!row) throw new Error('submit_community_report no devolvió fila');
  if (row.r_outcome === 'rate_limited' || !row.r_incident_id) return { kind: 'rate_limited' };
  return { kind: 'accepted', outcome: row.r_outcome, incidentId: row.r_incident_id, replayed: row.r_replayed };
}
