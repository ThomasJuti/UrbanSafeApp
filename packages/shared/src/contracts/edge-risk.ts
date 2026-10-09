import { z } from 'zod';
import { bboxSchema } from '../geo';
import { PARAMS } from '../params';

// Pedir toda la ciudad de una vez serían cientos de miles de tramos: la caja tiene tope.
export const edgeRiskQuerySchema = z.object({
  bbox: bboxSchema.refine(
    (b) => b.maxLng - b.minLng <= PARAMS.edgeRisk.maxBboxDeg && b.maxLat - b.minLat <= PARAMS.edgeRisk.maxBboxDeg,
    { message: 'bbox demasiado grande para el riesgo por calle' },
  ),
});
export type EdgeRiskQuery = z.output<typeof edgeRiskQuerySchema>;

export const edgeRiskSchema = z.object({
  risk: z.number().min(0).max(1),
  // [lng, lat], el orden de GeoJSON.
  path: z.array(z.tuple([z.number(), z.number()])).min(2),
});
export type EdgeRisk = z.infer<typeof edgeRiskSchema>;

export const edgeRiskResponseSchema = z.object({
  // Franja horaria (RN-11) con la que se tomó el riesgo.
  band: z.number().int().min(0),
  edges: z.array(edgeRiskSchema),
});
export type EdgeRiskResponse = z.infer<typeof edgeRiskResponseSchema>;
