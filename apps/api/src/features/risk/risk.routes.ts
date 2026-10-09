import { zValidator } from '@hono/zod-validator';
import { edgeRiskQuerySchema, PARAMS, timeBandOf, type EdgeRiskResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import { listEdgeRiskInBbox } from './risk.repository';

// El riesgo cambia con cada recálculo; un minuto de caché alivia a quien mueve el mapa.
const CACHE_MAX_AGE_S = 60;

export function createEdgeRiskRoutes(db: Db) {
  return new Hono().get('/', zValidator('query', edgeRiskQuerySchema), async (c) => {
    const { bbox } = c.req.valid('query');
    const band = timeBandOf(new Date());
    const edges = await listEdgeRiskInBbox(db, bbox, band, PARAMS.edgeRisk.limit);
    c.header('cache-control', `public, max-age=${CACHE_MAX_AGE_S}`);
    return c.json({ band, edges } satisfies EdgeRiskResponse);
  });
}
