import type { RouteKind, RouteOption } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { explainRoute } from './explain-route';

function option(kind: RouteKind, overrides: Partial<RouteOption> = {}): RouteOption {
  return {
    kind,
    lengthM: 1000,
    durationS: 140,
    riskScore: 0.3,
    riskLevel: 'medium',
    nearbyIncidentIds: [],
    path: [
      [-74.08, 4.65],
      [-74.07, 4.66],
    ],
    segments: [],
    hotIncidents: [],
    ...overrides,
  };
}

const robbery = { id: 'a', type: 'armed_robbery' } as const;

describe('explainRoute (M5, RN-13)', () => {
  it('dice si la opción es igual a la más rápida', () => {
    expect(explainRoute(option('safest'), option('fastest'))).toEqual(['Igual a la más rápida']);
  });

  it('dice qué zona caliente esquiva y cuántos incidentes evita', () => {
    const fastest = option('fastest', { hotIncidents: [robbery], nearbyIncidentIds: ['a', 'b', 'c'] });
    const safest = option('safest', { lengthM: 1400, nearbyIncidentIds: ['c'] });

    expect(explainRoute(safest, fastest)).toEqual([
      'Esquiva zona caliente: Atraco con arma',
      'Evita 2 incidentes cercanos a la más rápida',
    ]);
  });

  it('usa el singular para un solo incidente evitado', () => {
    const fastest = option('fastest', { nearbyIncidentIds: ['a'] });
    const safest = option('safest', { lengthM: 1200 });

    expect(explainRoute(safest, fastest)).toEqual(['Evita 1 incidente cercano a la más rápida']);
  });

  it('avisa cuando la más rápida pasa por una zona caliente', () => {
    expect(explainRoute(option('fastest', { hotIncidents: [robbery] }), option('fastest'))).toEqual([
      'Pasa por zona caliente: Atraco con arma',
    ]);
  });

  it('no repite etiquetas y avisa si la opción también pasa por la zona', () => {
    const hot = [robbery, { id: 'b', type: 'armed_robbery' as const }];
    const balanced = option('balanced', { lengthM: 1100, hotIncidents: hot });

    expect(explainRoute(balanced, option('fastest', { hotIncidents: hot }))).toEqual([
      'Pasa por zona caliente: Atraco con arma',
    ]);
  });

  it('la más rápida sin zonas calientes no lleva explicación', () => {
    expect(explainRoute(option('fastest'), option('fastest'))).toEqual([]);
  });
});
