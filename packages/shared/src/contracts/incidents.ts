import { z } from 'zod';
import { bboxSchema } from '../geo';
import { incidentSchema } from '../incident';

export const MAP_INCIDENTS_LIMIT = 2000;

export const listIncidentsQuerySchema = z.object({
  bbox: bboxSchema,
});
export type ListIncidentsQuery = z.output<typeof listIncidentsQuerySchema>;

// Datos públicos de la nota. Nunca el id del dispositivo: por eso el mapa no lleva `sources`.
export const newsCitationSchema = z.object({
  title: z.string().min(1).nullable(),
  media: z.string().min(1).nullable(),
  url: z.url(),
});
export type NewsCitation = z.infer<typeof newsCitationSchema>;

export const MAP_NEWS_LIMIT = 3;

// Sin `sources` a propósito: ahí va el id del dispositivo de quien reportó.
export const mapIncidentSchema = incidentSchema
  .pick({
    id: true,
    type: true,
    severity: true,
    location: true,
    occurredAt: true,
    timeKnown: true,
    confidence: true,
  })
  .extend({
    news: z.array(newsCitationSchema).max(MAP_NEWS_LIMIT).optional(),
  });
export type MapIncident = z.infer<typeof mapIncidentSchema>;

export const listIncidentsResponseSchema = z.object({
  incidents: z.array(mapIncidentSchema),
});
export type ListIncidentsResponse = z.infer<typeof listIncidentsResponseSchema>;
