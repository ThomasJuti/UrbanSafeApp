import { z } from 'zod';
import { latLngSchema } from '../geo';
import { PARAMS } from '../params';
import { ROUTE_KINDS, routeOptionSchema } from './routes';

export const DELIVERY_LEGS = ['to_pickup', 'to_dropoff'] as const;
export type DeliveryLeg = (typeof DELIVERY_LEGS)[number];

// offered: pedido nuevo, sin aceptar. routing: calculando las rutas del tramo. choosing: esperando
// que el domiciliario elija. riding: avanzando. delivered: con resumen. failed: un tramo sin ruta.
export const DELIVERY_STATUSES = ['offered', 'routing', 'choosing', 'riding', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const speedMultiplierSchema = z
  .number()
  .refine((value) => (PARAMS.delivery.speedMultipliers as readonly number[]).includes(value), {
    message: `La velocidad debe ser una de ${PARAMS.delivery.speedMultipliers.join(', ')}`,
  });

export const deliverySummarySchema = z.object({
  durationS: z.number().nonnegative(),
  lengthM: z.number().nonnegative(),
  // Frente a la ruta más rápida de cada tramo.
  extraTimeS: z.number(),
  // 1 − exposición(elegida) / exposición(rápida). Null si la rápida no tenía riesgo que evitar.
  exposureAvoided: z.number().max(1).nullable(),
  // Cercanos a la ruta más rápida de algún tramo y no a la elegida en ese tramo.
  incidentsAvoided: z.array(z.string()),
});
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;

export const deliveryStateSchema = z.object({
  sessionId: z.uuid(),
  status: z.enum(DELIVERY_STATUSES),
  order: z.object({ pickup: latLngSchema, dropoff: latLngSchema }),
  position: latLngSchema,
  leg: z.enum(DELIVERY_LEGS),
  // Las 3 rutas del tramo en curso; vacío hasta que se calculan.
  options: z.array(routeOptionSchema),
  chosen: z.enum(ROUTE_KINDS).nullable(),
  // Metros recorridos sobre la ruta elegida del tramo en curso.
  progressM: z.number().nonnegative(),
  speedMultiplier: speedMultiplierSchema,
  summary: deliverySummarySchema.nullable(),
});
export type DeliveryState = z.infer<typeof deliveryStateSchema>;

export const deliveryStateResponseSchema = z.object({ state: deliveryStateSchema });
export type DeliveryStateResponse = z.infer<typeof deliveryStateResponseSchema>;

export const chooseRouteBodySchema = z.object({ kind: z.enum(ROUTE_KINDS) });
export type ChooseRouteBody = z.infer<typeof chooseRouteBodySchema>;

export const setSpeedBodySchema = z.object({ multiplier: speedMultiplierSchema });
export type SetSpeedBody = z.infer<typeof setSpeedBodySchema>;

export const DELIVERY_ERRORS = {
  notFound: 'delivery_not_found',
  invalidState: 'delivery_invalid_state',
  noOrder: 'delivery_no_order',
} as const;
