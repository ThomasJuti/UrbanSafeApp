import type { CastVoteBody, CreateReportBody, MapIncident, ReportOutcome, VoteOutcome } from '@urbansafe/shared';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { getMapIncident } from '../incidents';
import { storeCommunityReport, storeVote } from './reports.repository';

export type SubmitReportResult =
  | { kind: 'accepted'; outcome: ReportOutcome; incident: MapIncident; replayed: boolean }
  | { kind: 'rate_limited' };

export async function submitReport(db: Db, bus: EventBus, report: CreateReportBody): Promise<SubmitReportResult> {
  const stored = await storeCommunityReport(db, report);
  if (stored.kind === 'rate_limited') return stored;

  const incident = await getMapIncident(db, stored.incidentId);
  if (!stored.replayed) {
    if (stored.outcome === 'created') bus.publish('incident.created', { incident });
    if (stored.outcome === 'confirmed') bus.publish('incident.updated', { incident });
  }
  return { kind: 'accepted', outcome: stored.outcome, incident, replayed: stored.replayed };
}

export type CastVoteResult = { kind: 'accepted'; outcome: VoteOutcome } | { kind: 'not_available' };

// F4: si la confianza cruza 0,1 el evento lleva el valor nuevo y cada mapa lo oculta o lo muestra (RN-12).
export async function castVote(db: Db, bus: EventBus, vote: CastVoteBody): Promise<CastVoteResult> {
  const stored = await storeVote(db, vote);
  if (stored.kind === 'not_available') return stored;

  if (stored.outcome === 'counted' && !stored.replayed) {
    bus.publish('incident.updated', { incident: await getMapIncident(db, vote.incidentId) });
  }
  return { kind: 'accepted', outcome: stored.outcome };
}
