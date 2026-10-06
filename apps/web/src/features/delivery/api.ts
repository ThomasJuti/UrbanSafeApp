import { deliveryStateResponseSchema, type DeliveryState, type RouteKind } from '@urbansafe/shared';
import { getResult, postJson, type PostResult } from '../../shared/http';

export type DeliveryFailure = 'not_found' | 'conflict' | 'busy' | 'rate_limited' | 'failed';
export type DeliveryCall = { ok: true; state: DeliveryState } | { ok: false; reason: DeliveryFailure };

// 503 también es "sin pedido cerca": para quien lo ve es lo mismo, reintentar en un momento.
const FAILURES: Record<number, DeliveryFailure> = { 404: 'not_found', 409: 'conflict', 429: 'rate_limited', 503: 'busy' };

async function call(request: () => Promise<PostResult<{ state: DeliveryState }>>): Promise<DeliveryCall> {
  try {
    const result = await request();
    if (result.ok) return { ok: true, state: result.data.state };
    return { ok: false, reason: FAILURES[result.status] ?? 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const sessionPath = (id: string, action?: string) =>
  `/api/delivery/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const deliveryApi = {
  create: () => call(() => postJson('/api/delivery/sessions', {}, deliveryStateResponseSchema)),
  get: (id: string) => call(() => getResult(sessionPath(id), deliveryStateResponseSchema)),
  accept: (id: string) => call(() => postJson(sessionPath(id, 'accept'), {}, deliveryStateResponseSchema)),
  chooseRoute: (id: string, kind: RouteKind) =>
    call(() => postJson(sessionPath(id, 'route'), { kind }, deliveryStateResponseSchema)),
  setSpeed: (id: string, multiplier: number) =>
    call(() => postJson(sessionPath(id, 'speed'), { multiplier }, deliveryStateResponseSchema)),
  next: (id: string) => call(() => postJson(sessionPath(id, 'next'), {}, deliveryStateResponseSchema)),
};
