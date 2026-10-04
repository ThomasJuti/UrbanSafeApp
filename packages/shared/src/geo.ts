import { z } from 'zod';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const bboxSchema = z
  .string()
  .transform((value, ctx) => {
    const parts = value.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: 'custom', message: 'bbox debe ser minLng,minLat,maxLng,maxLat' });
      return z.NEVER;
    }
    const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
    return { minLng, minLat, maxLng, maxLat };
  })
  .refine((b) => b.minLng >= -180 && b.maxLng <= 180 && b.minLat >= -90 && b.maxLat <= 90, {
    message: 'bbox fuera de rango',
  })
  .refine((b) => b.minLng < b.maxLng && b.minLat < b.maxLat, {
    message: 'bbox con mínimos mayores que máximos',
  });
export type Bbox = z.output<typeof bboxSchema>;

export function formatBbox(b: Bbox): string {
  return [b.minLng, b.minLat, b.maxLng, b.maxLat].join(',');
}
