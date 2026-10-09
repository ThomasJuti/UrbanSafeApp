import type { SafePlacesResponse } from '@urbansafe/shared';
import { Hono } from 'hono';
import type { Db } from '../../shared/db';
import { listSafePlaces } from './safe-places.repository';

// Los puntos cambian solo cuando alguien corre la importación.
const CACHE_MAX_AGE_S = 3600;

export function createSafePlacesRoutes(db: Db) {
  return new Hono().get('/', async (c) => {
    const places = await listSafePlaces(db);
    c.header('cache-control', `public, max-age=${CACHE_MAX_AGE_S}`);
    return c.json({ places } satisfies SafePlacesResponse);
  });
}
