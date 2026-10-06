import { z } from 'zod';
import { urbanPointSchema } from '../geo';
import { RISK_LEVELS } from '../risk';

export const routeRequestSchema = z.object({ from: urbanPointSchema, to: urbanPointSchema });
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const ROUTE_KINDS = ['fastest', 'balanced', 'safest'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const routeOptionSchema = z.object({
  kind: z.enum(ROUTE_KINDS),
  lengthM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  // Promedio de riesgo(tramo, hora) ponderado por tiempo de recorrido (M5).
  riskScore: z.number().min(0).max(1),
  riskLevel: z.enum(RISK_LEVELS),
  nearbyIncidentIds: z.array(z.string()),
  // [lng, lat], el orden de GeoJSON, para pasarlo directo a MapLibre.
  path: z.array(z.tuple([z.number(), z.number()])).min(2),
});
export type RouteOption = z.infer<typeof routeOptionSchema>;

export const routeResponseSchema = z.object({ routes: z.array(routeOptionSchema) });
export type RouteResponse = z.infer<typeof routeResponseSchema>;

// busy: la cola de ruteo está llena (503).
export const ROUTE_ERRORS = { noRoute: 'no_route', busy: 'routing_busy' } as const;
