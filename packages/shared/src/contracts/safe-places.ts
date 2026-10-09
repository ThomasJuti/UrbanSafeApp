import { z } from 'zod';
import { latLngSchema } from '../geo';

export const SAFE_PLACE_KINDS = ['police', 'fuel'] as const;
export const safePlaceKindSchema = z.enum(SAFE_PLACE_KINDS);
export type SafePlaceKind = z.infer<typeof safePlaceKindSchema>;

export const SAFE_PLACE_LABELS: Record<SafePlaceKind, string> = {
  police: 'CAI / Policía',
  fuel: 'Gasolinera 24 h',
};

export const safePlaceSchema = z.object({
  id: z.string(),
  kind: safePlaceKindSchema,
  name: z.string().nullable(),
  point: latLngSchema,
});
export type SafePlace = z.infer<typeof safePlaceSchema>;

export const safePlacesResponseSchema = z.object({ places: z.array(safePlaceSchema) });
export type SafePlacesResponse = z.infer<typeof safePlacesResponseSchema>;
