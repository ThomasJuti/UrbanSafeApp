import { zValidator } from '@hono/zod-validator';
import {
  listIncidentsQuerySchema,
  MAP_INCIDENTS_LIMIT,
  type ListIncidentsResponse,
} from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import { listVisibleInBbox } from './incidents.repository';

export function createIncidentsRoutes(db: Db) {
  return new Hono().get('/', zValidator('query', listIncidentsQuerySchema), async (c) => {
    const { bbox } = c.req.valid('query');
    const incidents = await listVisibleInBbox(db, bbox, MAP_INCIDENTS_LIMIT);
    return c.json({ incidents } satisfies ListIncidentsResponse);
  });
}
