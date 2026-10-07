import { latLngSchema } from '@urbansafe/shared';
import { z } from 'zod';

// Puerto del geocodificador (AGENTS: interfaz intercambiable). Hoy lo implementa Google.
export const viewportSchema = z.object({
  south: z.number(),
  west: z.number(),
  north: z.number(),
  east: z.number(),
});
export type Viewport = z.infer<typeof viewportSchema>;

export const geocodeResultSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('point'), point: latLngSchema }),
    z.object({ kind: z.literal('neighborhood'), name: z.string().min(1), point: latLngSchema, viewport: viewportSchema }),
    z.object({ kind: z.literal('locality'), name: z.string().min(1), point: latLngSchema }),
  ])
  .nullable();
// null: no se encontró un lugar dentro del casco urbano más preciso que "Bogotá".
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export interface Geocoder {
  geocode(locationText: string): Promise<GeocodeResult>;
}
