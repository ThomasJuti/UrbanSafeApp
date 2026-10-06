import { describe, expect, it } from 'vitest';
import { bboxSchema, destinationPoint, formatBbox, haversineM } from './geo';

describe('distancias', () => {
  it('un milésimo de grado de latitud son unos 111 m', () => {
    expect(haversineM([-74.1, 4.6], [-74.1, 4.601])).toBeCloseTo(111.2, 0);
  });

  it('destinationPoint deja el punto a la distancia y en el rumbo pedidos', () => {
    const from = { lat: 4.6, lng: -74.1 };
    const north = destinationPoint(from, 3000, 0);
    const east = destinationPoint(from, 3000, Math.PI / 2);

    expect(haversineM([from.lng, from.lat], [north.lng, north.lat])).toBeCloseTo(3000, 0);
    expect(north.lat).toBeGreaterThan(from.lat);
    expect(north.lng).toBeCloseTo(from.lng, 6);
    expect(east.lng).toBeGreaterThan(from.lng);
  });
});

describe('bboxSchema', () => {
  it('interpreta minLng,minLat,maxLng,maxLat', () => {
    expect(bboxSchema.parse('-74.2,4.5,-74.0,4.8')).toEqual({
      minLng: -74.2,
      minLat: 4.5,
      maxLng: -74.0,
      maxLat: 4.8,
    });
  });

  it('ida y vuelta con formatBbox', () => {
    const bbox = bboxSchema.parse('-74.2,4.5,-74,4.8');
    expect(bboxSchema.parse(formatBbox(bbox))).toEqual(bbox);
  });

  it.each([
    ['menos de 4 valores', '-74.2,4.5,-74.0'],
    ['valores no numéricos', '-74.2,a,-74.0,4.8'],
    ['mínimos mayores que máximos', '-74.0,4.8,-74.2,4.5'],
    ['latitud fuera de rango', '-74.2,-95,-74.0,4.8'],
  ])('rechaza %s', (_, value) => {
    expect(bboxSchema.safeParse(value).success).toBe(false);
  });
});
