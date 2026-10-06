import type { RouteKind, RouteOption } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { summarizeDelivery } from './delivery-summary';

function option(kind: RouteKind, durationS: number, riskScore: number, nearbyIncidentIds: string[] = []): RouteOption {
  return {
    kind,
    lengthM: durationS * 7,
    durationS,
    riskScore,
    riskLevel: 'low',
    nearbyIncidentIds,
    path: [
      [0, 0],
      [0, 1],
    ],
  };
}

describe('resumen de la entrega (M7)', () => {
  it('suma tiempo extra y exposición de los dos tramos frente a la más rápida de cada uno', () => {
    const summary = summarizeDelivery([
      // Exposición rápida 600 · 0,5 = 300; elegida 660 · 0,1 = 66.
      { fastest: option('fastest', 600, 0.5, ['a', 'b']), chosen: option('safest', 660, 0.1, ['b']) },
      // La rápida elegida: 100 contra 100.
      { fastest: option('fastest', 400, 0.25, ['c']), chosen: option('fastest', 400, 0.25, ['c']) },
    ]);

    expect(summary.durationS).toBe(1060);
    expect(summary.lengthM).toBe(1060 * 7);
    expect(summary.extraTimeS).toBe(60);
    expect(summary.exposureAvoided).toBeCloseTo(1 - 166 / 400);
    expect(summary.incidentsAvoided).toEqual(['a']);
  });

  it('sin riesgo en la ruta rápida no hay exposición que evitar', () => {
    const summary = summarizeDelivery([{ fastest: option('fastest', 600, 0), chosen: option('balanced', 620, 0) }]);
    expect(summary.exposureAvoided).toBeNull();
  });

  it('una ruta más larga con el mismo riesgo expone más: el valor evitado queda negativo', () => {
    const summary = summarizeDelivery([{ fastest: option('fastest', 600, 0.2), chosen: option('balanced', 900, 0.2) }]);
    expect(summary.exposureAvoided).toBeCloseTo(-0.5);
  });
});
