import { z } from 'zod';
import { latLngSchema, type LatLng } from '../geo';
import { PARAMS } from '../params';

export function isInsideUrbanArea({ lat, lng }: LatLng): boolean {
  const box = PARAMS.urbanBbox;
  return lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat;
}

const urbanPointSchema = latLngSchema.refine(isInsideUrbanArea, {
  message: 'El punto está fuera del casco urbano de Bogotá',
});

export const routeRequestSchema = z.object({ from: urbanPointSchema, to: urbanPointSchema });
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const ROUTE_KINDS = ['fastest', 'balanced', 'safest'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const routeOptionSchema = z.object({
  kind: z.enum(ROUTE_KINDS),
  lengthM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  // [lng, lat], el orden de GeoJSON, para pasarlo directo a MapLibre.
  path: z.array(z.tuple([z.number(), z.number()])).min(2),
});
export type RouteOption = z.infer<typeof routeOptionSchema>;

export const routeResponseSchema = z.object({ routes: z.array(routeOptionSchema) });
export type RouteResponse = z.infer<typeof routeResponseSchema>;

export const ROUTE_ERRORS = { noRoute: 'no_route' } as const;
