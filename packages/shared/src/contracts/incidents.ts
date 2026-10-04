import { z } from 'zod';
import { bboxSchema } from '../geo';
import { incidentSchema } from '../incident';

export const MAP_INCIDENTS_LIMIT = 2000;

export const listIncidentsQuerySchema = z.object({
  bbox: bboxSchema,
});
export type ListIncidentsQuery = z.output<typeof listIncidentsQuerySchema>;

// Sin `sources` a propósito: ahí va el id del dispositivo de quien reportó.
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
