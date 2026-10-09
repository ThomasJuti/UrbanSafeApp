import { zValidator } from '@hono/zod-validator';
import {
  castVoteBodySchema,
  createReportBodySchema,
  REPORT_ERRORS,
  type CastVoteResponse,
  type CreateReportResponse,
} from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import type { EventBus } from '../../shared/events';
import { isInsideBogota } from './reports.repository';
import { castVote, submitReport } from './reports.service';

export function createReportsRoutes(deps: { db: Db; bus: EventBus }) {
  return new Hono()
    .post('/', zValidator('json', createReportBodySchema), async (c) => {
      const body = c.req.valid('json');
      // El contrato ya exige el casco urbano; aquí se descartan los municipios vecinos que caen en él.
      if (!(await isInsideBogota(deps.db, body.point))) return c.json({ error: REPORT_ERRORS.outsideBogota }, 422);
      const result = await submitReport(deps.db, deps.bus, body);
      if (result.kind === 'rate_limited') return c.json({ error: REPORT_ERRORS.rateLimited }, 429);

      const response = { outcome: result.outcome, incident: result.incident } satisfies CreateReportResponse;
      return c.json(response, result.outcome === 'created' && !result.replayed ? 201 : 200);
    })
    .post('/votes', zValidator('json', castVoteBodySchema), async (c) => {
      const result = await castVote(deps.db, deps.bus, c.req.valid('json'));
      if (result.kind === 'not_available') return c.json({ error: REPORT_ERRORS.incidentNotAvailable }, 404);
      return c.json({ outcome: result.outcome } satisfies CastVoteResponse, 200);
    });
}
