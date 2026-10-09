import type { RouteKind, RouteOption } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { safeRouteVerdict, summarizeDelivery } from './delivery-summary';

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
    segments: [],
    hotIncidents: [],
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

  it('la más segura cumple el criterio si baja la exposición a la mitad sin pasar del 25 % de tiempo extra', () => {
    const legs = [
      { fastest: option('fastest', 600, 0.5), safest: option('safest', 660, 0.1) },
      { fastest: option('fastest', 400, 0.4), safest: option('safest', 420, 0.2) },
    ];
    const verdict = safeRouteVerdict(legs);
    expect(verdict.exposureReduction).toBeCloseTo(1 - 150 / 460);
    expect(verdict.extraTimeRatio).toBeCloseTo(80 / 1000);
    expect(verdict.meets).toBe(true);
  });

  it('no cumple si el ahorro de exposición exige más de un 25 % de tiempo extra', () => {
    const verdict = safeRouteVerdict([
      { fastest: option('fastest', 600, 0.5), safest: option('safest', 800, 0.1) },
    ]);
    expect(verdict.exposureReduction).toBeGreaterThan(0.5);
    expect(verdict.meets).toBe(false);
  });

  it('no cumple si la más rápida no tenía riesgo que evitar', () => {
    expect(safeRouteVerdict([{ fastest: option('fastest', 600, 0), safest: option('safest', 620, 0) }]).meets).toBe(
      false,
    );
  });

  it('una ruta más larga con el mismo riesgo expone más: el valor evitado queda negativo', () => {
    const summary = summarizeDelivery([{ fastest: option('fastest', 600, 0.2), chosen: option('balanced', 900, 0.2) }]);
    expect(summary.exposureAvoided).toBeCloseTo(-0.5);
  });
});
