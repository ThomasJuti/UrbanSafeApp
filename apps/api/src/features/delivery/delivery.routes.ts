import { zValidator } from '@hono/zod-validator';
import { chooseRouteBodySchema, DELIVERY_ERRORS, setSpeedBodySchema, type DeliveryStateResponse } from '@urbansafe/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { DeliveryResult, DeliveryService } from './delivery.service';

const sessionParamSchema = z.object({ id: z.uuid() });

const ERROR_RESPONSES = {
  not_found: { status: 404, error: DELIVERY_ERRORS.notFound },
  invalid_state: { status: 409, error: DELIVERY_ERRORS.invalidState },
  no_order: { status: 503, error: DELIVERY_ERRORS.noOrder },
} as const;

function respond(c: Context, result: DeliveryResult, successStatus: 200 | 201 = 200) {
  if (!result.ok) {
    const { status, error } = ERROR_RESPONSES[result.error];
    return c.json({ error }, status);
  }
  return c.json({ state: result.state } satisfies DeliveryStateResponse, successStatus);
}

// El id de la sesión es su credencial: solo lo conoce la pestaña que la creó (RN-03).
export function createDeliveryRoutes(service: DeliveryService) {
  const param = zValidator('param', sessionParamSchema);
  return new Hono()
    .post('/sessions', async (c) => respond(c, await service.create(), 201))
    .get('/sessions/:id', param, (c) => respond(c, service.get(c.req.valid('param').id)))
    .post('/sessions/:id/accept', param, async (c) => respond(c, await service.accept(c.req.valid('param').id)))
    .post('/sessions/:id/route', param, zValidator('json', chooseRouteBodySchema), async (c) =>
      respond(c, await service.chooseRoute(c.req.valid('param').id, c.req.valid('json').kind)),
    )
    .post('/sessions/:id/speed', param, zValidator('json', setSpeedBodySchema), async (c) =>
      respond(c, await service.setSpeed(c.req.valid('param').id, c.req.valid('json').multiplier)),
    )
    .post('/sessions/:id/next', param, async (c) => respond(c, await service.nextOrder(c.req.valid('param').id)));
}
