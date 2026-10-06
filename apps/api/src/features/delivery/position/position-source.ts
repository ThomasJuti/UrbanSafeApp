import type { LatLng } from '@urbansafe/shared';

export type PositionSample = { point: LatLng; progressM: number; arrived: boolean };

// De dónde sale la posición del domiciliario. Hoy solo existe la ruta simulada; el GPS real
// implementaría esta misma interfaz.
export type PositionSource = {
  advance(elapsedMs: number): PositionSample;
};
