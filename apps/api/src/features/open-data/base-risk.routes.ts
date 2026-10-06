import type { BaseRiskResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import { listBaseRisk } from './base-risk.repository';

// El dataset se publica una vez al mes; una hora de caché no deja nada viejo.
const CACHE_MAX_AGE_S = 3600;

export function createBaseRiskRoutes(db: Db) {
  return new Hono().get('/', async (c) => {
    const body = await listBaseRisk(db);
    c.header('cache-control', `public, max-age=${CACHE_MAX_AGE_S}`);
    return c.json(body satisfies BaseRiskResponse);
  });
}
