import { zValidator } from '@hono/zod-validator';
import { createReportBodySchema, REPORT_ERRORS, type CreateReportResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { submitReport } from './reports.service';

export function createReportsRoutes(deps: { db: Db; bus: EventBus }) {
  return new Hono().post('/', zValidator('json', createReportBodySchema), async (c) => {
    const result = await submitReport(deps.db, deps.bus, c.req.valid('json'));
    if (result.kind === 'rate_limited') return c.json({ error: REPORT_ERRORS.rateLimited }, 429);

    const body = { outcome: result.outcome, incident: result.incident } satisfies CreateReportResponse;
    return c.json(body, result.outcome === 'created' && !result.replayed ? 201 : 200);
  });
}
