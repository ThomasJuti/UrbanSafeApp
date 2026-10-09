import {
  compatibleTypes,
  PARAMS,
  severityOf,
  type CastVoteBody,
  type CreateReportBody,
  type LatLng,
  type ReportOutcome,
  type VoteOutcome,
} from '@urbansafe/shared';
import { sql } from 'kysely';
import type { Db } from '../../shared/db';

type ReportRow = { r_outcome: ReportOutcome | 'rate_limited'; r_incident_id: string | null; r_replayed: boolean };

export type StoredReport =
  | { kind: 'accepted'; outcome: ReportOutcome; incidentId: string; replayed: boolean }
  | { kind: 'rate_limited' };

// El casco urbano es un rectángulo que también toma municipios vecinos (Soacha, Mosquera, Chía…):
// un reporte solo vale si el punto cae en una localidad de Bogotá.
export async function isInsideBogota(db: Db, point: LatLng): Promise<boolean> {
  const { rows } = await sql<{ inside: boolean }>`
    select exists (
      select 1 from locality_base_risk l
      where ST_Intersects(l.geom, ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326))
    ) as inside
  `.execute(db);
  return rows[0]?.inside ?? false;
}

export async function storeCommunityReport(db: Db, report: CreateReportBody): Promise<StoredReport> {
  const { confirm, max } = PARAMS.confidenceAdjustments;
  const { rows } = await sql<ReportRow>`
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
      ${PARAMS.reputation.stepPerBalance}::real,
      ${PARAMS.reputation.maxInitialConfidence}::real,
      ${confirm}::real,
      ${max}::real
    )`.execute(db);

  const row = rows[0];
  if (!row) throw new Error('submit_community_report no devolvió fila');
  if (row.r_outcome === 'rate_limited' || !row.r_incident_id) return { kind: 'rate_limited' };
  return { kind: 'accepted', outcome: row.r_outcome, incidentId: row.r_incident_id, replayed: row.r_replayed };
}

type VoteRow = { r_outcome: VoteOutcome | 'not_available'; r_replayed: boolean };

export type StoredVote = { kind: 'accepted'; outcome: VoteOutcome; replayed: boolean } | { kind: 'not_available' };

export async function storeVote(db: Db, vote: CastVoteBody): Promise<StoredVote> {
  const { confirm, deny, max } = PARAMS.confidenceAdjustments;
  const { rows } = await sql<VoteRow>`
    select * from cast_incident_vote(
      ${vote.deviceId}::uuid,
      ${vote.nickname},
      ${vote.incidentId}::uuid,
      ${vote.vote},
      ${vote.vote === 'confirm' ? confirm : deny}::real,
      ${max}::real,
      ${PARAMS.visibilityThreshold}::real,
      ${PARAMS.mapWindowMs / 1000}::float8
    )`.execute(db);

  const row = rows[0];
  if (!row) throw new Error('cast_incident_vote no devolvió fila');
  if (row.r_outcome === 'not_available') return { kind: 'not_available' };
  return { kind: 'accepted', outcome: row.r_outcome, replayed: row.r_replayed };
}
