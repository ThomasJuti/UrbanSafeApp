import { z } from 'zod';
import { PARAMS } from './params';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export function isInsideUrbanArea({ lat, lng }: LatLng): boolean {
  const box = PARAMS.urbanBbox;
  return lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat;
}

// Rutas, reportes y pedidos solo tienen sentido sobre el grafo, que cubre el casco urbano (M5).
export const urbanPointSchema = latLngSchema.refine(isInsideUrbanArea, {
  message: 'El punto está fuera del casco urbano de Bogotá',
});

// [lng, lat], el orden de GeoJSON.
export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineM(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Punto a `distanceM` de `from` en el rumbo dado (radianes, 0 = norte, en sentido horario).
export function destinationPoint(from: LatLng, distanceM: number, bearingRad: number): LatLng {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const angular = distanceM / EARTH_RADIUS_M;
  const lat1 = toRad(from.lat);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad),
  );
  const lng2 =
    toRad(from.lng) +
    Math.atan2(Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

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
