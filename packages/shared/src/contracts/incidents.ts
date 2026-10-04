import { z } from 'zod';
import { bboxSchema } from '../geo';
import { incidentSchema } from '../incident';

/** Tope de incidentes por respuesta del mapa, para mantener la lectura bajo 200 ms. */
export const MAP_INCIDENTS_LIMIT = 2000;

export const listIncidentsQuerySchema = z.object({
  bbox: bboxSchema,
});
export type ListIncidentsQuery = z.output<typeof listIncidentsQuerySchema>;

// Payload mínimo para el mapa: sin fuentes, que exponen identificadores de dispositivo.
export const mapIncidentSchema = incidentSchema.pick({
  id: true,
  type: true,
  severity: true,
  location: true,
  occurredAt: true,
  timeKnown: true,
  confidence: true,
});
export type MapIncident = z.infer<typeof mapIncidentSchema>;

export const listIncidentsResponseSchema = z.object({
  incidents: z.array(mapIncidentSchema),
});
export type ListIncidentsResponse = z.infer<typeof listIncidentsResponseSchema>;
