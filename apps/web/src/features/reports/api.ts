import { createReportResponseSchema, type CreateReportBody, type ReportOutcome } from '@urbansafe/shared';
import { postJson } from '../../shared/http';

const TOO_MANY_REQUESTS = 429;

export type SubmitResult = { kind: 'accepted'; outcome: ReportOutcome } | { kind: 'rate_limited' } | { kind: 'failed' };

export async function submitReport(body: CreateReportBody): Promise<SubmitResult> {
  try {
    const result = await postJson('/api/reports', body, createReportResponseSchema);
    if (result.ok) return { kind: 'accepted', outcome: result.data.outcome };
    return result.status === TOO_MANY_REQUESTS ? { kind: 'rate_limited' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
