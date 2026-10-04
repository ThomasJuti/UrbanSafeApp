import { describe, expect, it } from 'vitest';
import { bboxSchema, formatBbox } from './geo';

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
