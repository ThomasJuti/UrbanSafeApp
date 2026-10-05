import type { CreateReportBody, MapIncident, ReportOutcome } from '@urbansafe/shared';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { getMapIncident } from '../incidents';
import { storeCommunityReport } from './reports.repository';

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
