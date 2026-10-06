import { describe, expect, it } from 'vitest';
import { createReportBodySchema } from './reports';

const body = {
  clientId: '7f6b1c1e-8a4e-4c55-9d2a-2f7e0c3b1a10',
  deviceId: '3c9a2d4b-1e7f-4a6b-8c5d-9e0f1a2b3c4d',
  nickname: 'tester',
  type: 'fight',
};

describe('cuerpo de un reporte', () => {
  it('acepta un punto dentro del casco urbano', () => {
    expect(createReportBodySchema.safeParse({ ...body, point: { lat: 4.65, lng: -74.1 } }).success).toBe(true);
  });

  it('rechaza un punto fuera de Bogotá: no entra al mapa ni al riesgo de tramos', () => {
    expect(createReportBodySchema.safeParse({ ...body, point: { lat: 6.25, lng: -75.57 } }).success).toBe(false);
  });
});
