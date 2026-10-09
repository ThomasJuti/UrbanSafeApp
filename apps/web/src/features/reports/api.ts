import {
  castVoteResponseSchema,
  createReportResponseSchema,
  type CastVoteBody,
  type CreateReportBody,
  type ReportOutcome,
  type VoteOutcome,
} from '@urbansafe/shared';
import { postJson } from '../../shared/http';

const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;
const UNPROCESSABLE = 422;

export type SubmitResult =
  | { kind: 'accepted'; outcome: ReportOutcome }
  | { kind: 'rate_limited' }
  | { kind: 'outside_bogota' }
  | { kind: 'failed' };

export async function submitReport(body: CreateReportBody): Promise<SubmitResult> {
  try {
    const result = await postJson('/api/reports', body, createReportResponseSchema);
    if (result.ok) return { kind: 'accepted', outcome: result.data.outcome };
    if (result.status === TOO_MANY_REQUESTS) return { kind: 'rate_limited' };
    return result.status === UNPROCESSABLE ? { kind: 'outside_bogota' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export type VoteResult = { kind: 'accepted'; outcome: VoteOutcome } | { kind: 'not_available' } | { kind: 'failed' };

export async function castVote(body: CastVoteBody): Promise<VoteResult> {
  try {
    const result = await postJson('/api/reports/votes', body, castVoteResponseSchema);
    if (result.ok) return { kind: 'accepted', outcome: result.data.outcome };
    return result.status === NOT_FOUND ? { kind: 'not_available' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
