import { z } from 'zod';

const positionSchema = z.tuple([z.number(), z.number()]);

export const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(positionSchema))),
});
export type MultiPolygon = z.infer<typeof multiPolygonSchema>;

export const baseRiskZoneSchema = z.object({
  code: z.string(),
  name: z.string(),
  baseRisk: z.number().min(0).max(1),
  geometry: multiPolygonSchema,
});
export type BaseRiskZone = z.infer<typeof baseRiskZoneSchema>;

export const baseRiskResponseSchema = z.object({
  // Null mientras no se haya importado nada.
  period: z.string().nullable(),
  zones: z.array(baseRiskZoneSchema),
});
export type BaseRiskResponse = z.infer<typeof baseRiskResponseSchema>;
