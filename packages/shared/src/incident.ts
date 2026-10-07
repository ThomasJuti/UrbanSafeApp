import { z } from 'zod';
import { incidentTypeSchema } from './catalog';
import { latLngSchema } from './geo';

export const SOURCE_KINDS = ['news', 'community'] as const;
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const incidentSourceSchema = z.object({
  kind: sourceKindSchema,
  // news: URL del artículo. community: id anónimo del dispositivo.
  ref: z.string().min(1),
});
export type IncidentSource = z.infer<typeof incidentSourceSchema>;

export const AREA_LEVELS = ['neighborhood', 'locality', 'street'] as const;
export const areaLevelSchema = z.enum(AREA_LEVELS);
export type AreaLevel = z.infer<typeof areaLevelSchema>;

export const incidentLocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), point: latLngSchema }),
  z.object({
    kind: z.literal('area'),
    level: areaLevelSchema,
    name: z.string().min(1),
    point: latLngSchema,
  }),
]);
export type IncidentLocation = z.infer<typeof incidentLocationSchema>;

export const severitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const incidentSchema = z.object({
  id: z.uuid(),
  type: incidentTypeSchema,
  severity: severitySchema,
  location: incidentLocationSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  timeKnown: z.boolean(),
  reportedAt: z.iso.datetime({ offset: true }),
  sources: z.array(incidentSourceSchema).min(1),
  confidence: z.number().min(0).max(1),
});
export type Incident = z.infer<typeof incidentSchema>;
